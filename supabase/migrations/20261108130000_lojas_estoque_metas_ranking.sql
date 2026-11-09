-- Ajustes de 08/11/2026:
--   1. trocar vendedor só para pessoa ativa na loja
--   2. Admin geral de lojas (100) também cria lojas
--   3. lançamentos de estoque: corrigir quantidade, desfazer e refazer (todos os tipos)
--   4/5. metas dos vendedores (mínima, média, FULL) e ranking — em combos, a métrica que o vendedor já vê
--        (ranking em R$ mostraria o faturamento, que é só da Administração)

-- ───────────────────────── 1. Trocar vendedor: só ativos ─────────────────────────
create or replace function public.trocar_vendedor(p_venda_id bigint, p_vendedor_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.vendas;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if not (private.meu_role() >= 90 and private.acessa_loja(v.loja_id)) then raise exception 'Sem permissão'; end if;
  if v.anulada then raise exception 'Venda anulada'; end if;
  if v.vendedor_id = p_vendedor_id then return; end if;
  if not exists (select 1 from public.loja_membros m join public.profiles p on p.id = m.user_id
                 where m.loja_id = v.loja_id and m.user_id = p_vendedor_id and m.ativo and p.ativo) then
    raise exception 'Vendedor inativo ou de outra loja';
  end if;

  update public.vendas set vendedor_id = p_vendedor_id where id = p_venda_id;
  insert into public.eventos (tipo, venda_id, descricao, user_id)
  values ('troca_vendedor', p_venda_id,
          format('Venda %s: %s → %s', p_venda_id,
                 (select nome from public.profiles where id = v.vendedor_id),
                 (select nome from public.profiles where id = p_vendedor_id)),
          (select auth.uid()));
end $$;

-- ───────────────────────── 2. Lojas ─────────────────────────
-- Admin geral (100) cria e ativa/desativa as lojas dele; quem cria (não sendo 200) vira membro para enxergá-la.
drop policy lojas_update on public.lojas;
create policy lojas_update on public.lojas for update to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(id))
  with check (private.meu_role() >= 100 and private.acessa_loja(id));

create function public.criar_loja(p_nome text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if coalesce(private.meu_role(), 0) < 100 then raise exception 'Só a administração cria lojas'; end if;
  insert into public.lojas (nome) values (p_nome) returning id into v_id;
  if private.meu_role() < 200 then
    insert into public.loja_membros (loja_id, user_id) values (v_id, (select auth.uid()));
  end if;
  return v_id;
end $$;
revoke all on function public.criar_loja(text) from public, anon;
grant execute on function public.criar_loja(text) to authenticated;

-- ───────────────────────── 3. Corrigir / desfazer / refazer lançamento ─────────────────────────
-- Desfazer = quantidade 0 (o registro fica). Refazer = volta para quantidade_anterior.
-- Contagem não se desfaz (0 é uma contagem válida): só se corrige.
-- Vendedor altera só o que lançou; chefe+ qualquer lançamento da loja.
alter table public.estoque_movimentos add column quantidade_anterior integer;

alter table public.eventos drop constraint eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check
  check (tipo in ('troca_vendedor', 'anulacao', 'edicao', 'edicao_amostra', 'edicao_movimento'));

drop function public.editar_amostra(bigint, integer, text);
create function public.editar_movimento(p_id bigint, p_quantidade integer, p_comentario text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.estoque_movimentos;
  v_produto public.produtos;
  v_comentario text := nullif(btrim(p_comentario), '');
  v_contagem boolean;
begin
  select * into m from public.estoque_movimentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  select * into v_produto from public.produtos where id = m.produto_id;
  if private.meu_role() is null or not private.acessa_loja(v_produto.loja_id) then
    raise exception 'Sem permissão';
  end if;
  if private.meu_role() < 90 and m.created_by is distinct from (select auth.uid()) then
    raise exception 'Vendedor só altera os lançamentos que fez';
  end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Quantidade inválida'; end if;
  if p_quantidade = m.quantidade and v_comentario is not distinct from m.comentario then return; end if;
  v_contagem := m.tipo = 'inventario';

  update public.estoque_movimentos
  set quantidade = p_quantidade, comentario = v_comentario, editado_por = (select auth.uid()), editado_em = now(),
      quantidade_anterior = case when p_quantidade <> m.quantidade then m.quantidade else quantidade_anterior end
  where id = p_id;

  insert into public.eventos (tipo, movimento_id, descricao, user_id)
  values (case when m.tipo = 'amostra' then 'edicao_amostra' else 'edicao_movimento' end, p_id,
          format('%s de %s lançada em %s por %s: %s',
                 case m.tipo when 'entrada' then 'Compra' when 'devolucao' then 'Devolução'
                   when 'amostra' then 'Amostra' when 'doacao' then 'Doação' when 'avaria' then 'Estragou'
                   else 'Contagem' end,
                 v_produto.nome,
                 to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 coalesce((select nome from public.profiles where id = m.created_by), '—'),
                 concat_ws('; ',
                   case when p_quantidade <> m.quantidade then
                     case when p_quantidade = 0 and not v_contagem then format('desfeita (era %s)', m.quantidade)
                          when m.quantidade = 0 and not v_contagem then format('refeita (%s)', p_quantidade)
                          else format('quantidade %s → %s', m.quantidade, p_quantidade) end end,
                   case when v_comentario is distinct from m.comentario then
                     format('comentário "%s" → "%s"', coalesce(m.comentario, ''), coalesce(v_comentario, '')) end)),
          (select auth.uid()));
end $$;
revoke all on function public.editar_movimento(bigint, integer, text) from public, anon;
grant execute on function public.editar_movimento(bigint, integer, text) to authenticated;

-- Desfaz um lançamento inteiro (vários produtos) numa transação: o "Desfazer" logo após confirmar.
create function public.desfazer_movimentos(p_ids bigint[])
returns void
language plpgsql set search_path = '' as $$
declare
  v_id bigint;
begin
  if exists (select 1 from public.estoque_movimentos where id = any(p_ids) and tipo = 'inventario') then
    raise exception 'Contagem não se desfaz: corrija a quantidade';
  end if;
  foreach v_id in array p_ids loop
    perform public.editar_movimento(v_id, 0, (select comentario from public.estoque_movimentos where id = v_id));
  end loop;
end $$;
revoke all on function public.desfazer_movimentos(bigint[]) from public, anon;
grant execute on function public.desfazer_movimentos(bigint[]) to authenticated;

-- confirmar_movimento passa a devolver os ids gravados (para o "Desfazer")
drop function public.confirmar_movimento(bigint, text, jsonb, text);
create function public.confirmar_movimento(p_loja_id bigint, p_tipo text, p_itens jsonb, p_comentario text)
returns bigint[]
language plpgsql set search_path = '' as $$
declare
  v_ids bigint[];
begin
  if private.meu_role() is null or not private.acessa_loja(p_loja_id) then raise exception 'Sem permissão'; end if;
  if p_tipo = 'doacao' and private.meu_role() < 90 then
    raise exception 'Doação só com autorização de chefe de loja ou administração';
  end if;
  if coalesce(jsonb_array_length(p_itens), 0) = 0 then raise exception 'Nenhum produto no lançamento'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_itens) i
    left join public.produtos pr on pr.id = (i->>'produto_id')::bigint and pr.loja_id = p_loja_id and pr.ativo
    where pr.id is null or (i->>'quantidade') is null
       or (i->>'quantidade')::int < case when p_tipo = 'inventario' then 0 else 1 end
  ) then
    raise exception 'Produto ou quantidade inválidos';
  end if;
  if (select count(*) <> count(distinct i->>'produto_id') from jsonb_array_elements(p_itens) i) then
    raise exception 'Produto repetido no lançamento';
  end if;

  with ins as (
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, comentario, saldo_anterior, entradas, saidas)
    select (i->>'produto_id')::bigint, p_tipo, (i->>'quantidade')::int, nullif(btrim(p_comentario), ''),
           case when p_tipo = 'inventario' then e.saldo_inventario end,
           case when p_tipo = 'inventario' then e.entradas end,
           case when p_tipo = 'inventario' then e.amostras + e.outras_saidas + e.vendidos end
    from jsonb_array_elements(p_itens) i
    left join public.estoque_loja(p_loja_id) e on e.produto_id = (i->>'produto_id')::bigint
    returning id
  )
  select array_agg(id order by id) into v_ids from ins;

  delete from public.estoque_rascunhos
  where loja_id = p_loja_id and user_id = (select auth.uid()) and tipo = p_tipo;
  return v_ids;
end $$;
revoke all on function public.confirmar_movimento(bigint, text, jsonb, text) from public, anon;
grant execute on function public.confirmar_movimento(bigint, text, jsonb, text) to authenticated;

-- ───────────────────────── 4/5. Metas e ranking ─────────────────────────
-- ponytail: uma meta mensal por vendedor e loja (vale para todo mês); tabela por mês se as metas mudarem mês a mês
create table public.metas (
  loja_id bigint not null references public.lojas on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  meta_minima numeric(12, 2) not null check (meta_minima > 0),
  meta_media numeric(12, 2) not null,
  meta_full numeric(12, 2) not null,
  updated_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (loja_id, user_id),
  check (meta_minima <= meta_media and meta_media <= meta_full)
);
create index metas_user_idx on public.metas (user_id);
create index metas_updated_by_idx on public.metas (updated_by);
alter table public.metas enable row level security;
create policy metas_select on public.metas for select to authenticated
  using (private.acessa_loja(loja_id));
create policy metas_insert on public.metas for insert to authenticated
  with check (private.meu_role() >= 90 and private.acessa_loja(loja_id));
create policy metas_update on public.metas for update to authenticated
  using (private.meu_role() >= 90 and private.acessa_loja(loja_id))
  with check (private.meu_role() >= 90 and private.acessa_loja(loja_id));
create policy metas_delete on public.metas for delete to authenticated
  using (private.meu_role() >= 90 and private.acessa_loja(loja_id));
grant select, insert, update, delete on public.metas to authenticated;

-- Ranking: vendedores e chefes ativos da loja (admins fora), combos de vendas não anuladas no período.
-- DEFINER: o vendedor enxerga os combos dos colegas (só combos, sem valores em R$).
create function public.ranking_vendedores(p_loja_id bigint, p_de date, p_ate date)
returns table (
  user_id uuid,
  nome text,
  combos numeric,
  itens integer,
  vendas integer,
  meta_minima numeric,
  meta_media numeric,
  meta_full numeric
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, coalesce(s.combos, 0), coalesce(s.itens, 0)::int, coalesce(s.vendas, 0)::int,
         mt.meta_minima, mt.meta_media, mt.meta_full
  from public.loja_membros m
  join public.profiles p on p.id = m.user_id
  left join lateral (
    select sum(i.valor_combo * i.quantidade) as combos, sum(i.quantidade) as itens, count(distinct v.id) as vendas
    from public.vendas v join public.venda_itens i on i.venda_id = v.id
    where v.loja_id = p_loja_id and v.vendedor_id = p.id and not v.anulada
      and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
      and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
  ) s on true
  left join public.metas mt on mt.loja_id = p_loja_id and mt.user_id = p.id
  where m.loja_id = p_loja_id and m.ativo and p.ativo and p.role < 100
    and private.acessa_loja(p_loja_id)
  order by 3 desc, p.nome
$$;
revoke all on function public.ranking_vendedores(bigint, date, date) from public, anon;
grant execute on function public.ranking_vendedores(bigint, date, date) to authenticated;
