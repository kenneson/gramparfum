-- Ajustes de 14/11/2026 (pedido do dono):
--   1. Lançamentos por perfil: vendedor só conta; chefe de loja compra, abre amostra e conta;
--      doação e "estragou" só administração. Devolução e recuperação só pelas funções próprias.
--   2. Desfazer/corrigir lançamento: justificativa obrigatória; abaixo da administração, só o que a pessoa lançou.
--   3. Valores de venda: vendedor e chefe só do dia de hoje (fechamento de caixa); outros dias só quantidades.
--   4. Devolução no caixa (vendedor e administração; chefe de loja não): o produto volta ao estoque e/ou
--      o valor sai do caixa, escolhido na hora. Com valor devolvido, os combos saem do ranking.
--   5. Contagem com falta: a administração cobra o valor da pessoa, registra que o produto voltou
--      (volta ao estoque) ou aceita a diferença ("acertado com a pessoa").
--   6. Meta da loja (mínima, média, máxima) para todos; a meta individual vale por cima. Só administração define.
--   7. Histórico só da administração + auditoria: toda alteração nas tabelas principais (quem, quando, antes/depois).

create function private.hoje() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;
grant execute on function private.hoje() to authenticated;

-- ───────────────────────── Tabelas novas ─────────────────────────

create table public.devolucoes (
  id bigint generated always as identity primary key,
  venda_id bigint not null references public.vendas,
  loja_id bigint not null references public.lojas,
  volta_estoque boolean not null,
  devolve_valor boolean not null,
  forma smallint check (forma between 1 and 5), -- como o valor saiu do caixa
  valor numeric(12, 2) not null default 0 check (valor >= 0), -- valor dos produtos devolvidos
  motivo text not null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  desfeita_por uuid references public.profiles,
  desfeita_em timestamptz,
  motivo_desfeita text,
  check (devolve_valor = (forma is not null))
);
create index devolucoes_venda_idx on public.devolucoes (venda_id);
create index devolucoes_loja_data_idx on public.devolucoes (loja_id, created_at);
create index devolucoes_created_by_idx on public.devolucoes (created_by);
create index devolucoes_desfeita_por_idx on public.devolucoes (desfeita_por);

create table public.devolucao_itens (
  id bigint generated always as identity primary key,
  devolucao_id bigint not null references public.devolucoes on delete cascade,
  produto_id bigint not null references public.produtos,
  quantidade integer not null check (quantidade > 0),
  preco numeric(12, 2) not null, -- preço médio pago na venda
  valor_combo numeric(12, 2) not null default 0
);
create index devolucao_itens_devolucao_idx on public.devolucao_itens (devolucao_id);
create index devolucao_itens_produto_idx on public.devolucao_itens (produto_id);

-- Falta de contagem resolvida pela administração: valor cobrado, produto que voltou ou diferença aceita
create table public.recuperacoes (
  id bigint generated always as identity primary key,
  loja_id bigint not null references public.lojas,
  movimento_id bigint not null references public.estoque_movimentos, -- a contagem com falta
  produto_id bigint not null references public.produtos,
  responsavel_id uuid references public.profiles, -- de quem foi cobrado / com quem foi acertado
  tipo text not null check (tipo in ('valor', 'produto', 'acerto')),
  quantidade integer not null check (quantidade > 0),
  valor numeric(12, 2) not null default 0 check (valor >= 0),
  forma smallint check (forma between 1 and 5),
  comentario text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  desfeita_por uuid references public.profiles,
  desfeita_em timestamptz,
  motivo_desfeita text,
  check ((tipo = 'valor') = (forma is not null))
);
create index recuperacoes_loja_data_idx on public.recuperacoes (loja_id, created_at);
create index recuperacoes_movimento_idx on public.recuperacoes (movimento_id);
create index recuperacoes_produto_idx on public.recuperacoes (produto_id);
create index recuperacoes_responsavel_idx on public.recuperacoes (responsavel_id);
create index recuperacoes_created_by_idx on public.recuperacoes (created_by);
create index recuperacoes_desfeita_por_idx on public.recuperacoes (desfeita_por);

create table public.metas_loja (
  loja_id bigint primary key references public.lojas on delete cascade,
  meta_minima numeric(12, 2) not null check (meta_minima > 0),
  meta_media numeric(12, 2) not null,
  meta_maxima numeric(12, 2) not null,
  updated_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now(),
  check (meta_minima <= meta_media and meta_media <= meta_maxima)
);
create index metas_loja_updated_by_idx on public.metas_loja (updated_by);

create table public.auditoria (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles on delete set null, -- null = sistema / Gestão (servidor)
  loja_id bigint references public.lojas on delete set null,
  tabela text not null,
  acao text not null check (acao in ('INSERT', 'UPDATE', 'DELETE')),
  registro_id text,
  antes jsonb, -- UPDATE: só os campos que mudaram
  depois jsonb
);
create index auditoria_data_idx on public.auditoria (created_at desc);
create index auditoria_loja_data_idx on public.auditoria (loja_id, created_at desc);
create index auditoria_user_data_idx on public.auditoria (user_id, created_at desc);

alter table public.estoque_movimentos
  add column devolucao_id bigint references public.devolucoes,
  add column recuperacao_id bigint references public.recuperacoes,
  add column motivo_edicao text;
create index estoque_mov_devolucao_idx on public.estoque_movimentos (devolucao_id);
create index estoque_mov_recuperacao_idx on public.estoque_movimentos (recuperacao_id);

alter table public.estoque_movimentos drop constraint estoque_movimentos_tipo_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_check
  check (tipo in ('entrada', 'devolucao', 'amostra', 'doacao', 'avaria', 'inventario', 'recuperacao'));

alter table public.eventos add column loja_id bigint references public.lojas;
create index eventos_loja_data_idx on public.eventos (loja_id, created_at desc);
alter table public.eventos drop constraint eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check
  check (tipo in ('troca_vendedor', 'anulacao', 'edicao', 'edicao_amostra', 'edicao_movimento',
                  'devolucao', 'desfazer_devolucao', 'recuperacao', 'desfazer_recuperacao', 'gestao'));

update public.eventos e set loja_id = v.loja_id from public.vendas v where e.venda_id = v.id and e.loja_id is null;
update public.eventos e set loja_id = p.loja_id
from public.estoque_movimentos m join public.produtos p on p.id = m.produto_id
where e.movimento_id = m.id and e.loja_id is null;

-- funções antigas gravam eventos sem loja: completa pela venda ou pelo lançamento
create function private.evento_loja() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.loja_id is null then
    new.loja_id := coalesce(
      (select loja_id from public.vendas where id = new.venda_id),
      (select p.loja_id from public.estoque_movimentos m join public.produtos p on p.id = m.produto_id
       where m.id = new.movimento_id));
  end if;
  return new;
end $$;
create trigger eventos_loja before insert on public.eventos
  for each row execute function private.evento_loja();

-- textos digitados (mesma regra do app)
create trigger devolucoes_textos before insert or update of motivo, motivo_desfeita on public.devolucoes
  for each row execute function private.validar_textos('motivo:500:obrigatorio:Motivo',
                                                       'motivo_desfeita:500:opcional:Justificativa');
create trigger recuperacoes_textos before insert or update of comentario, motivo_desfeita on public.recuperacoes
  for each row execute function private.validar_textos('comentario:500:opcional:Comentário',
                                                       'motivo_desfeita:500:opcional:Justificativa');
create trigger estoque_movimentos_motivo before insert or update of motivo_edicao on public.estoque_movimentos
  for each row execute function private.validar_textos('motivo_edicao:500:opcional:Justificativa');

-- ───────────────────────── RLS das tabelas novas ─────────────────────────
-- Devoluções: leitura e escrita só pelas funções (valores ficam fora da leitura direta, como nas vendas).
alter table public.devolucoes enable row level security;
alter table public.devolucao_itens enable row level security;

alter table public.recuperacoes enable row level security;
create policy recuperacoes_select on public.recuperacoes for select to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(loja_id));
grant select on public.recuperacoes to authenticated;

alter table public.metas_loja enable row level security;
create policy metas_loja_select on public.metas_loja for select to authenticated
  using (private.acessa_loja(loja_id));
create policy metas_loja_insert on public.metas_loja for insert to authenticated
  with check (private.meu_role() >= 100 and private.acessa_loja(loja_id));
create policy metas_loja_update on public.metas_loja for update to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(loja_id))
  with check (private.meu_role() >= 100 and private.acessa_loja(loja_id));
create policy metas_loja_delete on public.metas_loja for delete to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(loja_id));
grant select, insert, update, delete on public.metas_loja to authenticated;

-- metas individuais: só administração define (antes chefe+)
drop policy metas_insert on public.metas;
drop policy metas_update on public.metas;
drop policy metas_delete on public.metas;
create policy metas_insert on public.metas for insert to authenticated
  with check (private.meu_role() >= 100 and private.acessa_loja(loja_id));
create policy metas_update on public.metas for update to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(loja_id))
  with check (private.meu_role() >= 100 and private.acessa_loja(loja_id));
create policy metas_delete on public.metas for delete to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(loja_id));

-- Auditoria e histórico: só administração. Admin do sistema vê tudo; admin de lojas, as lojas dele.
alter table public.auditoria enable row level security;
create policy auditoria_select on public.auditoria for select to authenticated
  using (private.meu_role() = 200 or (private.meu_role() >= 100 and private.acessa_loja(loja_id)));
grant select on public.auditoria to authenticated;

drop policy eventos_select on public.eventos;
create policy eventos_select on public.eventos for select to authenticated
  using (private.meu_role() = 200 or (private.meu_role() >= 100 and private.acessa_loja(loja_id)));

drop policy acessos_select on public.acessos;
create policy acessos_select on public.acessos for select to authenticated
  using (user_id = (select auth.uid()) or private.meu_role() >= 100);

-- ───────────────────────── Auditoria ─────────────────────────
-- AFTER trigger genérico: grava quem (auth.uid), quando, tabela, e antes/depois (no UPDATE, só o que mudou).
-- Ações da Gestão rodam no servidor (service role, sem usuário): o autor fica no evento 'gestao'.
create function private.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  d jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r) loop
      if a->k is not distinct from d->k then
        a := a - k;
        d := d - k;
      end if;
    end loop;
    if d = '{}'::jsonb then return null; end if;
  end if;

  insert into public.auditoria (user_id, loja_id, tabela, acao, registro_id, antes, depois)
  values (
    (select auth.uid()),
    case tg_table_name
      when 'lojas' then (r->>'id')::bigint
      when 'estoque_movimentos' then (select loja_id from public.produtos where id = (r->>'produto_id')::bigint)
      when 'profiles' then null
      else (r->>'loja_id')::bigint
    end,
    tg_table_name, tg_op, coalesce(r->>'id', r->>'user_id', r->>'loja_id'), a, d);
  return null;
end $$;
revoke all on function private.auditar() from public, anon, authenticated;

create trigger auditar after insert or update or delete on public.lojas for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.profiles for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.loja_membros for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.produtos for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.vendas for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.estoque_movimentos for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.metas for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.metas_loja for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.devolucoes for each row execute function private.auditar();
create trigger auditar after insert or update or delete on public.recuperacoes for each row execute function private.auditar();

-- ───────────────────────── 1. Lançamentos por perfil ─────────────────────────
create function private.pode_lancar(p_tipo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when private.meu_role() is null then false
    when p_tipo = 'inventario' then true
    when p_tipo in ('entrada', 'amostra') then private.meu_role() >= 90
    when p_tipo in ('doacao', 'avaria') then private.meu_role() >= 100
    else false -- devolução e recuperação: só pelas funções próprias
  end
$$;
revoke all on function private.pode_lancar(text) from public, anon;
grant execute on function private.pode_lancar(text) to authenticated;

drop policy estoque_insert on public.estoque_movimentos;
create policy estoque_insert on public.estoque_movimentos for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.produtos p where p.id = produto_id)
    and editado_por is null and editado_em is null
    and devolucao_id is null and recuperacao_id is null
    and (tipo = 'inventario' or quantidade > 0)
    and private.pode_lancar(tipo)
  );

create or replace function public.confirmar_movimento(p_loja_id bigint, p_tipo text, p_itens jsonb, p_comentario text)
returns bigint[]
language plpgsql set search_path = '' as $$
declare
  v_ids bigint[];
begin
  if private.meu_role() is null or not private.acessa_loja(p_loja_id) then raise exception 'Sem permissão'; end if;
  if not private.pode_lancar(p_tipo) then
    raise exception '%', case
      when p_tipo in ('entrada', 'amostra') then 'Compra e amostra só pelo chefe de loja ou administração'
      when p_tipo in ('devolucao') then 'Devolução se faz no Caixa'
      else 'Só a administração faz este lançamento' end;
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

-- recuperação de produto conta como entrada
create or replace function public.estoque_loja(p_loja_id bigint)
returns table (
  produto_id bigint,
  ultimo_inventario timestamptz,
  saldo_inventario integer,
  entradas integer,
  amostras integer,
  outras_saidas integer,
  vendidos integer,
  estoque integer,
  minimo integer
)
language sql stable security definer set search_path = '' as $$
  select p.id,
         inv.created_at,
         coalesce(inv.quantidade, 0),
         coalesce(m.entradas, 0)::int,
         coalesce(m.amostras, 0)::int,
         coalesce(m.outras, 0)::int,
         coalesce(vd.vendidos, 0)::int,
         (coalesce(inv.quantidade, 0) + coalesce(m.entradas, 0) - coalesce(m.amostras, 0)
           - coalesce(m.outras, 0) - coalesce(vd.vendidos, 0))::int,
         p.estoque_minimo
  from public.produtos p
  left join lateral (
    select e.quantidade, e.created_at from public.estoque_movimentos e
    where e.produto_id = p.id and e.tipo = 'inventario'
    order by e.created_at desc limit 1
  ) inv on true
  left join lateral (
    select sum(e.quantidade) filter (where e.tipo in ('entrada', 'devolucao', 'recuperacao')) as entradas,
           sum(e.quantidade) filter (where e.tipo = 'amostra') as amostras,
           sum(e.quantidade) filter (where e.tipo in ('doacao', 'avaria')) as outras
    from public.estoque_movimentos e
    where e.produto_id = p.id and e.tipo <> 'inventario'
      and e.created_at > coalesce(inv.created_at, '-infinity')
  ) m on true
  left join lateral (
    select sum(vi.quantidade) as vendidos
    from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
    where vi.produto_id = p.id and not v.anulada
      and v.created_at > coalesce(inv.created_at, '-infinity')
  ) vd on true
  where p.loja_id = p_loja_id and p.ativo and private.acessa_loja(p_loja_id)
$$;

-- ───────────────────────── 2. Corrigir / desfazer com justificativa ─────────────────────────
drop function public.desfazer_movimentos(bigint[]);
drop function public.editar_movimento(bigint, integer, text);

create function public.editar_movimento(p_id bigint, p_quantidade integer, p_comentario text, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.estoque_movimentos;
  v_produto public.produtos;
  v_comentario text := nullif(btrim(p_comentario), '');
  v_motivo text := nullif(btrim(regexp_replace(p_motivo, '\s+', ' ', 'g')), '');
  v_contagem boolean;
begin
  select * into m from public.estoque_movimentos where id = p_id for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  select * into v_produto from public.produtos where id = m.produto_id;
  if private.meu_role() is null or not private.acessa_loja(v_produto.loja_id) then
    raise exception 'Sem permissão';
  end if;
  if private.meu_role() < 100 and m.created_by is distinct from (select auth.uid()) then
    raise exception 'Você só altera os lançamentos que fez (os de outras pessoas, só a administração)';
  end if;
  if m.devolucao_id is not null or m.recuperacao_id is not null then
    raise exception 'Este lançamento veio de uma devolução ou recuperação: desfaça por lá';
  end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Quantidade inválida'; end if;
  if p_quantidade = m.quantidade and v_comentario is not distinct from m.comentario then return; end if;
  if v_motivo is null then raise exception 'Justificativa: campo obrigatório'; end if;
  v_contagem := m.tipo = 'inventario';

  update public.estoque_movimentos
  set quantidade = p_quantidade, comentario = v_comentario, editado_por = (select auth.uid()), editado_em = now(),
      motivo_edicao = v_motivo,
      quantidade_anterior = case when p_quantidade <> m.quantidade then m.quantidade else quantidade_anterior end
  where id = p_id
  returning motivo_edicao into v_motivo; -- já limpo pelo trigger

  insert into public.eventos (tipo, movimento_id, loja_id, descricao, user_id)
  values (case when m.tipo = 'amostra' then 'edicao_amostra' else 'edicao_movimento' end, p_id, v_produto.loja_id,
          format('%s de %s lançada em %s por %s: %s. Justificativa: %s',
                 case m.tipo when 'entrada' then 'Compra' when 'devolucao' then 'Devolução'
                   when 'amostra' then 'Amostra' when 'doacao' then 'Doação' when 'avaria' then 'Estragou'
                   when 'recuperacao' then 'Recuperação' else 'Contagem' end,
                 v_produto.nome,
                 to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 coalesce((select nome from public.profiles where id = m.created_by), '—'),
                 concat_ws('; ',
                   case when p_quantidade <> m.quantidade then
                     case when p_quantidade = 0 and not v_contagem then format('desfeita (era %s)', m.quantidade)
                          when m.quantidade = 0 and not v_contagem then format('refeita (%s)', p_quantidade)
                          else format('quantidade %s → %s', m.quantidade, p_quantidade) end end,
                   case when v_comentario is distinct from m.comentario then
                     format('comentário "%s" → "%s"', coalesce(m.comentario, ''), coalesce(v_comentario, '')) end),
                 v_motivo),
          (select auth.uid()));
end $$;
revoke all on function public.editar_movimento(bigint, integer, text, text) from public, anon;
grant execute on function public.editar_movimento(bigint, integer, text, text) to authenticated;

create function public.desfazer_movimentos(p_ids bigint[], p_motivo text)
returns void
language plpgsql set search_path = '' as $$
declare
  v_id bigint;
begin
  if exists (select 1 from public.estoque_movimentos where id = any(p_ids) and tipo = 'inventario') then
    raise exception 'Contagem não se desfaz: corrija a quantidade';
  end if;
  foreach v_id in array p_ids loop
    perform public.editar_movimento(v_id, 0, (select comentario from public.estoque_movimentos where id = v_id), p_motivo);
  end loop;
end $$;
revoke all on function public.desfazer_movimentos(bigint[], text) from public, anon;
grant execute on function public.desfazer_movimentos(bigint[], text) to authenticated;

-- ───────────────────────── 3. Relatório: valores só de hoje abaixo da administração ─────────────────────────
-- + 'devolvido': valor devolvido ao cliente nesta venda (devoluções ativas com valor)
create or replace function public.relatorio_vendas(p_loja_id bigint, p_de date, p_ate date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with ctx as (
    select private.meu_role() as role,
           coalesce(private.meu_role() >= 100, false) or (p_de = p_ate and p_de = private.hoje()) as completo
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'created_at', v.created_at,
           'anulada', v.anulada,
           'anulacao', case when v.anulada then jsonb_build_object(
             'motivo', v.motivo_anulacao, 'por', an.nome, 'em', v.anulada_em) end,
           'vendedor_id', v.vendedor_id,
           'total', case when ctx.completo then v.total end,
           'troco', case when ctx.completo then v.troco end,
           'devolvido', case when ctx.completo then (
             select coalesce(sum(d.valor), 0) from public.devolucoes d
             where d.venda_id = v.id and d.devolve_valor and d.desfeita_em is null) end,
           'vendedor', jsonb_build_object('nome', vd.nome),
           'operador', case when op.id is not null then jsonb_build_object('nome', op.nome) end,
           'venda_itens', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'produto_id', i.produto_id,
                      'preco', case when ctx.completo then i.preco end,
                      'quantidade', i.quantidade,
                      'valor_combo', i.valor_combo,
                      'produtos', jsonb_build_object('nome', pr.nome)) order by i.id), '[]'::jsonb)
             from public.venda_itens i join public.produtos pr on pr.id = i.produto_id
             where i.venda_id = v.id),
           'venda_pagamentos', case when ctx.completo then (
             select coalesce(jsonb_agg(jsonb_build_object('forma', g.forma, 'valor', g.valor, 'comentario', g.comentario)
                                       order by g.id), '[]'::jsonb)
             from public.venda_pagamentos g
             where g.venda_id = v.id) else '[]'::jsonb end
         ) order by v.created_at), '[]'::jsonb)
  from ctx
  cross join public.vendas v
  join public.profiles vd on vd.id = v.vendedor_id
  left join public.profiles op on op.id = v.created_by
  left join public.profiles an on an.id = v.anulada_por
  where v.loja_id = p_loja_id
    and private.acessa_loja(p_loja_id)
    and (ctx.role >= 90 or v.vendedor_id = (select auth.uid()))
    and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
    and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
$$;

-- ───────────────────────── 4. Devolução no caixa ─────────────────────────
-- Venda com devolução ativa não se anula nem se edita (o estoque e o caixa contariam duas vezes)
create function private.bloquear_venda_com_devolucao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.devolucoes d
             where d.venda_id = coalesce((to_jsonb(old)->>'venda_id')::bigint, (to_jsonb(old)->>'id')::bigint)
               and d.desfeita_em is null) then
    raise exception 'Venda com devolução registrada: peça à administração para desfazer a devolução antes';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger vendas_devolucao before update of anulada on public.vendas
  for each row when (new.anulada and not old.anulada) execute function private.bloquear_venda_com_devolucao();
create trigger venda_itens_devolucao before delete on public.venda_itens
  for each row execute function private.bloquear_venda_com_devolucao();

-- Venda pelo número do ticket, com o que ainda dá para devolver. Vendedor e administração (chefe de loja não).
create function public.venda_para_devolucao(p_loja_id bigint, p_venda_id bigint)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id,
    'created_at', v.created_at,
    'anulada', v.anulada,
    'vendedor', vd.nome,
    'itens', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'produto_id', x.produto_id, 'nome', pr.nome, 'vendido', x.q, 'preco', x.preco,
               'devolvido', coalesce((
                 select sum(di.quantidade) from public.devolucao_itens di
                 join public.devolucoes d on d.id = di.devolucao_id
                 where d.venda_id = v.id and d.desfeita_em is null and di.produto_id = x.produto_id), 0))
             order by pr.nome), '[]'::jsonb)
      from (select produto_id, sum(quantidade) as q, round(sum(preco * quantidade) / sum(quantidade), 2) as preco
            from public.venda_itens where venda_id = v.id group by produto_id) x
      join public.produtos pr on pr.id = x.produto_id))
  from public.vendas v
  join public.profiles vd on vd.id = v.vendedor_id
  where v.id = p_venda_id and v.loja_id = p_loja_id
    and private.acessa_loja(p_loja_id) and coalesce(private.meu_role() <> 90, false)
$$;
revoke all on function public.venda_para_devolucao(bigint, bigint) from public, anon;
grant execute on function public.venda_para_devolucao(bigint, bigint) to authenticated;

-- p_itens: [{produto_id, quantidade}]. Produto volta ao estoque (p_volta_estoque) e/ou o valor sai do caixa
-- pela forma p_forma (p_devolve_valor). Os dois ligados = como uma venda cancelada só nesses produtos.
create function public.registrar_devolucao(p_venda_id bigint, p_itens jsonb, p_volta_estoque boolean,
                                           p_devolve_valor boolean, p_forma smallint, p_motivo text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v public.vendas;
  v_dev bigint;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if not found or not coalesce(private.acessa_loja(v.loja_id), false) then raise exception 'Venda não encontrada'; end if;
  if private.meu_role() is null then raise exception 'Sem permissão'; end if;
  if private.meu_role() = 90 then raise exception 'Chefe de loja não faz devolução'; end if;
  if v.anulada then raise exception 'Venda anulada: não há o que devolver'; end if;
  if not coalesce(p_volta_estoque, false) and not coalesce(p_devolve_valor, false) then
    raise exception 'Escolha o que fazer: voltar o produto ao estoque, devolver o valor ou os dois';
  end if;
  if p_devolve_valor and (p_forma is null or p_forma not between 1 and 5) then
    raise exception 'Informe como o valor foi devolvido ao cliente';
  end if;
  if v_motivo is null then raise exception 'Motivo: campo obrigatório'; end if;
  if coalesce(jsonb_array_length(p_itens), 0) = 0 then raise exception 'Escolha ao menos um produto'; end if;
  if (select count(*) <> count(distinct i->>'produto_id') from jsonb_array_elements(p_itens) i) then
    raise exception 'Produto repetido na devolução';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_itens) i
    left join lateral (
      select sum(vi.quantidade) as q from public.venda_itens vi
      where vi.venda_id = p_venda_id and vi.produto_id = (i->>'produto_id')::bigint
    ) s on true
    left join lateral (
      select sum(di.quantidade) as q from public.devolucao_itens di
      join public.devolucoes d on d.id = di.devolucao_id
      where d.venda_id = p_venda_id and d.desfeita_em is null and di.produto_id = (i->>'produto_id')::bigint
    ) dv on true
    where (i->>'quantidade') is null or (i->>'quantidade')::int <= 0 or s.q is null
       or (i->>'quantidade')::int > s.q - coalesce(dv.q, 0)
  ) then
    raise exception 'Quantidade maior do que a vendida (ou já devolvida)';
  end if;

  insert into public.devolucoes (venda_id, loja_id, volta_estoque, devolve_valor, forma, motivo)
  values (p_venda_id, v.loja_id, p_volta_estoque, p_devolve_valor,
          case when p_devolve_valor then p_forma end, p_motivo)
  returning id into v_dev;

  insert into public.devolucao_itens (devolucao_id, produto_id, quantidade, preco, valor_combo)
  select v_dev, (i->>'produto_id')::bigint, (i->>'quantidade')::int, s.preco, s.combo
  from jsonb_array_elements(p_itens) i
  cross join lateral (
    select round(sum(vi.preco * vi.quantidade) / sum(vi.quantidade), 2) as preco, max(vi.valor_combo) as combo
    from public.venda_itens vi where vi.venda_id = p_venda_id and vi.produto_id = (i->>'produto_id')::bigint
  ) s;

  update public.devolucoes
  set valor = (select coalesce(sum(preco * quantidade), 0) from public.devolucao_itens where devolucao_id = v_dev)
  where id = v_dev;

  if p_volta_estoque then
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, comentario, devolucao_id, created_by)
    select produto_id, 'devolucao', quantidade, format('Devolução da venda nº %s', p_venda_id), v_dev, (select auth.uid())
    from public.devolucao_itens where devolucao_id = v_dev;
  end if;

  insert into public.eventos (tipo, venda_id, loja_id, descricao, user_id)
  select 'devolucao', p_venda_id, v.loja_id,
         format('Devolução na venda %s de %s (vendedor %s), feita por %s: %s. %s. %s. Motivo: %s',
                p_venda_id,
                to_char(v.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                (select nome from public.profiles where id = v.vendedor_id),
                (select nome from public.profiles where id = (select auth.uid())),
                (select string_agg(format('%s× %s', di.quantidade, pr.nome), ', ' order by di.id)
                 from public.devolucao_itens di join public.produtos pr on pr.id = di.produto_id
                 where di.devolucao_id = v_dev),
                case when d.volta_estoque then 'Produto voltou ao estoque' else 'Produto NÃO voltou ao estoque' end,
                case when d.devolve_valor then format('Valor devolvido: %s (forma %s)', d.valor, d.forma)
                     else 'Valor não devolvido' end,
                d.motivo),
         (select auth.uid())
  from public.devolucoes d where d.id = v_dev;
  return v_dev;
end $$;
revoke all on function public.registrar_devolucao(bigint, jsonb, boolean, boolean, smallint, text) from public, anon;
grant execute on function public.registrar_devolucao(bigint, jsonb, boolean, boolean, smallint, text) to authenticated;

-- Só administração; o estoque e o caixa voltam como estavam (o registro fica, marcado como desfeito)
create function public.desfazer_devolucao(p_id bigint, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.devolucoes;
begin
  select * into d from public.devolucoes where id = p_id for update;
  if not found or not coalesce(private.acessa_loja(d.loja_id), false) then raise exception 'Devolução não encontrada'; end if;
  if coalesce(private.meu_role(), 0) < 100 then raise exception 'Só a administração desfaz devoluções'; end if;
  if d.desfeita_em is not null then return; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Justificativa: campo obrigatório'; end if;

  update public.devolucoes
  set desfeita_por = (select auth.uid()), desfeita_em = now(), motivo_desfeita = p_motivo
  where id = p_id;
  update public.estoque_movimentos
  set quantidade_anterior = quantidade, quantidade = 0, editado_por = (select auth.uid()), editado_em = now(),
      motivo_edicao = p_motivo
  where devolucao_id = p_id and quantidade > 0;

  insert into public.eventos (tipo, venda_id, loja_id, descricao, user_id)
  values ('desfazer_devolucao', d.venda_id, d.loja_id,
          format('Devolução da venda %s (de %s) desfeita por %s. Justificativa: %s', d.venda_id,
                 to_char(d.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 (select nome from public.profiles where id = (select auth.uid())),
                 (select motivo_desfeita from public.devolucoes where id = p_id)),
          (select auth.uid()));
end $$;
revoke all on function public.desfazer_devolucao(bigint, text) from public, anon;
grant execute on function public.desfazer_devolucao(bigint, text) to authenticated;

-- ───────────────────────── 5. Divergências de contagem e recuperados ─────────────────────────
-- Contagens com falta (contado < esperado) e quanto dela já foi resolvido. Só administração.
create function public.divergencias_loja(p_loja_id bigint)
returns table (
  movimento_id bigint,
  produto_id bigint,
  produto text,
  preco numeric,
  contado_em timestamptz,
  contado_por text,
  contado_por_id uuid,
  esperado integer,
  contado integer,
  falta integer,
  resolvido integer
)
language sql stable security definer set search_path = '' as $$
  select e.id, p.id, p.nome, p.preco, e.created_at, pf.nome, e.created_by,
         x.esperado, e.quantidade, x.esperado - e.quantidade,
         coalesce((select sum(r.quantidade) from public.recuperacoes r
                   where r.movimento_id = e.id and r.desfeita_em is null), 0)::int
  from public.estoque_movimentos e
  join public.produtos p on p.id = e.produto_id
  left join public.profiles pf on pf.id = e.created_by
  cross join lateral (
    select (coalesce(e.saldo_anterior, 0) + coalesce(e.entradas, 0) - coalesce(e.saidas, 0))::int as esperado
  ) x
  where p.loja_id = p_loja_id and e.tipo = 'inventario'
    -- ponytail: contagens do sistema antigo (importadas) ficam fora; trocar por uma data móvel se a lista crescer
    and e.created_at >= timestamptz '2026-11-14 00:00:00-03'
    and x.esperado > e.quantidade
    and coalesce(private.meu_role() >= 100, false) and private.acessa_loja(p_loja_id)
  order by e.created_at desc
$$;
revoke all on function public.divergencias_loja(bigint) from public, anon;
grant execute on function public.divergencias_loja(bigint) to authenticated;

-- p_tipo: 'valor' (cobrado da pessoa, entra no caixa pela forma), 'produto' (voltou ao estoque),
-- 'acerto' (diferença aceita; comentário obrigatório, ex.: "acertado com fulano")
create function public.registrar_recuperacao(p_movimento_id bigint, p_tipo text, p_quantidade integer,
                                             p_valor numeric, p_forma smallint, p_responsavel uuid, p_comentario text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_id bigint;
begin
  if coalesce(private.meu_role(), 0) < 100 then raise exception 'Só a administração registra recuperações'; end if;
  select e.id, e.produto_id, e.created_at, p.loja_id, p.nome,
         (coalesce(e.saldo_anterior, 0) + coalesce(e.entradas, 0) - coalesce(e.saidas, 0) - e.quantidade) as falta,
         coalesce((select sum(r.quantidade) from public.recuperacoes r
                   where r.movimento_id = e.id and r.desfeita_em is null), 0) as resolvido
    into d
  from public.estoque_movimentos e join public.produtos p on p.id = e.produto_id
  where e.id = p_movimento_id and e.tipo = 'inventario';
  if not found or not private.acessa_loja(d.loja_id) then raise exception 'Contagem não encontrada'; end if;
  if p_tipo is null or p_tipo not in ('valor', 'produto', 'acerto') then raise exception 'Tipo inválido'; end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > d.falta - d.resolvido then
    raise exception 'Quantidade maior do que a falta pendente (%)', greatest(d.falta - d.resolvido, 0);
  end if;
  if p_tipo = 'valor' and (p_valor is null or p_valor <= 0) then raise exception 'Informe o valor recebido'; end if;
  if p_tipo = 'valor' and (p_forma is null or p_forma not between 1 and 5) then
    raise exception 'Informe a forma de pagamento';
  end if;
  if p_tipo in ('valor', 'acerto') and p_responsavel is null then raise exception 'Informe a pessoa'; end if;
  if p_tipo = 'acerto' and nullif(btrim(p_comentario), '') is null then
    raise exception 'Comentário: campo obrigatório';
  end if;
  if p_responsavel is not null
     and not exists (select 1 from public.loja_membros where loja_id = d.loja_id and user_id = p_responsavel) then
    raise exception 'Pessoa não é desta loja';
  end if;

  insert into public.recuperacoes (loja_id, movimento_id, produto_id, responsavel_id, tipo, quantidade, valor, forma, comentario)
  values (d.loja_id, d.id, d.produto_id, p_responsavel, p_tipo, p_quantidade,
          case when p_tipo = 'valor' then p_valor else 0 end, case when p_tipo = 'valor' then p_forma end, p_comentario)
  returning id into v_id;

  if p_tipo = 'produto' then
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, comentario, recuperacao_id, created_by)
    values (d.produto_id, 'recuperacao', p_quantidade, 'Produto recuperado (falta na contagem)', v_id, (select auth.uid()));
  end if;

  insert into public.eventos (tipo, movimento_id, loja_id, descricao, user_id)
  values ('recuperacao', d.id, d.loja_id,
          format('%s: %s× %s (falta na contagem de %s), registrado por %s%s%s',
                 case p_tipo when 'valor' then format('Valor cobrado (%s, forma %s)', p_valor, p_forma)
                             when 'produto' then 'Produto voltou ao estoque'
                             else 'Diferença aceita' end,
                 p_quantidade, d.nome,
                 to_char(d.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 (select nome from public.profiles where id = (select auth.uid())),
                 coalesce(' · pessoa: ' || (select nome from public.profiles where id = p_responsavel), ''),
                 coalesce(' · ' || (select comentario from public.recuperacoes where id = v_id), '')),
          (select auth.uid()));
  return v_id;
end $$;
revoke all on function public.registrar_recuperacao(bigint, text, integer, numeric, smallint, uuid, text) from public, anon;
grant execute on function public.registrar_recuperacao(bigint, text, integer, numeric, smallint, uuid, text) to authenticated;

create function public.desfazer_recuperacao(p_id bigint, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.recuperacoes;
begin
  select * into r from public.recuperacoes where id = p_id for update;
  if not found or not coalesce(private.acessa_loja(r.loja_id), false) then raise exception 'Recuperação não encontrada'; end if;
  if coalesce(private.meu_role(), 0) < 100 then raise exception 'Só a administração desfaz recuperações'; end if;
  if r.desfeita_em is not null then return; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Justificativa: campo obrigatório'; end if;

  update public.recuperacoes
  set desfeita_por = (select auth.uid()), desfeita_em = now(), motivo_desfeita = p_motivo
  where id = p_id;
  update public.estoque_movimentos
  set quantidade_anterior = quantidade, quantidade = 0, editado_por = (select auth.uid()), editado_em = now(),
      motivo_edicao = p_motivo
  where recuperacao_id = p_id and quantidade > 0;

  insert into public.eventos (tipo, movimento_id, loja_id, descricao, user_id)
  values ('desfazer_recuperacao', r.movimento_id, r.loja_id,
          format('Recuperação de %s× %s desfeita por %s. Justificativa: %s', r.quantidade,
                 (select nome from public.produtos where id = r.produto_id),
                 (select nome from public.profiles where id = (select auth.uid())),
                 (select motivo_desfeita from public.recuperacoes where id = p_id)),
          (select auth.uid()));
end $$;
revoke all on function public.desfazer_recuperacao(bigint, text) from public, anon;
grant execute on function public.desfazer_recuperacao(bigint, text) to authenticated;

-- ───────────────────────── 6. Caixa do período: devoluções e recuperados ─────────────────────────
-- Mesma regra do relatorio_vendas: valores completos para administração, ou para todos só no dia de hoje.
-- Vendedor: as devoluções que fez ou das vendas dele. Recuperados com valor: administração vê tudo;
-- chefe de loja vê só valor e forma (o que entrou no caixa), sem nomes.
create function public.relatorio_caixa(p_loja_id bigint, p_de date, p_ate date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with ctx as (
    select private.meu_role() as role,
           coalesce(private.meu_role() >= 100, false) or (p_de = p_ate and p_de = private.hoje()) as completo
  )
  select jsonb_build_object(
    'devolucoes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id,
               'created_at', d.created_at,
               'venda_id', d.venda_id,
               'vendedor_id', v.vendedor_id,
               'vendedor', vd.nome,
               'por', pf.nome,
               'motivo', d.motivo,
               'volta_estoque', d.volta_estoque,
               'devolve_valor', d.devolve_valor,
               'forma', case when ctx.completo then d.forma end,
               'valor', case when ctx.completo then d.valor end,
               'desfeita', d.desfeita_em is not null,
               'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'produto_id', di.produto_id, 'nome', pr.nome, 'quantidade', di.quantidade,
                                  'valor_combo', di.valor_combo) order by di.id), '[]'::jsonb)
                         from public.devolucao_itens di join public.produtos pr on pr.id = di.produto_id
                         where di.devolucao_id = d.id)
             ) order by d.created_at), '[]'::jsonb)
      from public.devolucoes d
      join public.vendas v on v.id = d.venda_id
      join public.profiles vd on vd.id = v.vendedor_id
      left join public.profiles pf on pf.id = d.created_by
      where d.loja_id = p_loja_id
        and (ctx.role >= 90 or d.created_by = (select auth.uid()) or v.vendedor_id = (select auth.uid()))
        and d.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
        and d.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'),
    'recuperacoes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id,
               'created_at', r.created_at,
               'tipo', r.tipo,
               'forma', r.forma,
               'valor', r.valor,
               'quantidade', case when ctx.role >= 100 then r.quantidade end,
               'produto', case when ctx.role >= 100 then pr.nome end,
               'pessoa', case when ctx.role >= 100 then rp.nome end
             ) order by r.created_at), '[]'::jsonb)
      from public.recuperacoes r
      join public.produtos pr on pr.id = r.produto_id
      left join public.profiles rp on rp.id = r.responsavel_id
      where ctx.completo and ctx.role >= 90
        and r.loja_id = p_loja_id and r.desfeita_em is null
        and (ctx.role >= 100 or r.tipo = 'valor')
        and r.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
        and r.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
  from ctx
  where private.acessa_loja(p_loja_id)
$$;
revoke all on function public.relatorio_caixa(bigint, date, date) from public, anon;
grant execute on function public.relatorio_caixa(bigint, date, date) to authenticated;

-- ───────────────────────── 7. Ranking: meta da loja + devoluções ─────────────────────────
-- Meta = individual se houver, senão a da loja. Devolução com valor devolvido tira os combos (na data da devolução).
drop function public.ranking_vendedores(bigint, date, date);
create function public.ranking_vendedores(p_loja_id bigint, p_de date, p_ate date)
returns table (
  user_id uuid,
  nome text,
  combos numeric,
  itens integer,
  vendas integer,
  meta_minima numeric,
  meta_media numeric,
  meta_full numeric,
  meta_individual boolean
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, coalesce(s.combos, 0) - coalesce(dv.combos, 0), coalesce(s.itens, 0)::int,
         coalesce(s.vendas, 0)::int,
         coalesce(mt.meta_minima, ml.meta_minima), coalesce(mt.meta_media, ml.meta_media),
         coalesce(mt.meta_full, ml.meta_maxima), mt.user_id is not null
  from public.loja_membros m
  join public.profiles p on p.id = m.user_id
  left join lateral (
    select sum(i.valor_combo * i.quantidade) as combos, sum(i.quantidade) as itens, count(distinct v.id) as vendas
    from public.vendas v join public.venda_itens i on i.venda_id = v.id
    where v.loja_id = p_loja_id and v.vendedor_id = p.id and not v.anulada
      and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
      and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
  ) s on true
  left join lateral (
    select sum(di.valor_combo * di.quantidade) as combos
    from public.devolucoes d
    join public.devolucao_itens di on di.devolucao_id = d.id
    join public.vendas v on v.id = d.venda_id
    where d.loja_id = p_loja_id and v.vendedor_id = p.id and d.devolve_valor and d.desfeita_em is null
      and d.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
      and d.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
  ) dv on true
  left join public.metas mt on mt.loja_id = p_loja_id and mt.user_id = p.id
  left join public.metas_loja ml on ml.loja_id = p_loja_id
  where m.loja_id = p_loja_id and m.ativo and p.ativo and p.role < 100
    and private.acessa_loja(p_loja_id)
  order by 3 desc, p.nome
$$;
revoke all on function public.ranking_vendedores(bigint, date, date) from public, anon;
grant execute on function public.ranking_vendedores(bigint, date, date) to authenticated;
