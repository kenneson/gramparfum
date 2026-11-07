-- Inventário repaginado: tipos de entrada/saída, estoque mínimo por produto e rascunho com autosave.
--
-- Tipos (estoque_movimentos.tipo):
--   entrada    = compra direta de fornecedor (valor legado mantido)   +
--   devolucao  = cliente devolveu produto comprado                    +
--   amostra    = provador aberto                                      −
--   doacao     = saída com 100% de desconto, só chefe+ (autorização)  −
--   avaria     = estragou                                             −
--   inventario = contagem (quantidade = total contado)
-- Venda não é lançamento manual: vem de venda_itens (caixa).

alter table public.estoque_movimentos drop constraint estoque_movimentos_tipo_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_check
  check (tipo in ('entrada', 'devolucao', 'amostra', 'doacao', 'avaria', 'inventario'));

alter table public.produtos add column estoque_minimo integer not null default 0 check (estoque_minimo >= 0);

-- Qualquer membro lança qualquer tipo (fica em created_by); doação só chefe+.
drop policy estoque_insert on public.estoque_movimentos;
create policy estoque_insert on public.estoque_movimentos for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.meu_role() is not null
    and exists (select 1 from public.produtos p where p.id = produto_id)
    and editado_por is null and editado_em is null
    and (tipo = 'inventario' or quantidade > 0)
    and (tipo <> 'doacao' or private.meu_role() >= 90)
  );

-- ───────────────────────── Estoque atual ─────────────────────────
-- Muda o retorno (outras_saidas, minimo): precisa recriar.
drop function public.estoque_loja(bigint);
create function public.estoque_loja(p_loja_id bigint)
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
    select sum(e.quantidade) filter (where e.tipo in ('entrada', 'devolucao')) as entradas,
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
revoke all on function public.estoque_loja(bigint) from public, anon;
grant execute on function public.estoque_loja(bigint) to authenticated;

-- ───────────────────────── Rascunho (autosave) ─────────────────────────
-- Um rascunho por pessoa, loja e tipo. itens: [{produto_id, quantidade}]. Não mexe no estoque.
create table public.estoque_rascunhos (
  loja_id bigint not null references public.lojas on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  tipo text not null check (tipo in ('entrada', 'devolucao', 'amostra', 'doacao', 'avaria', 'inventario')),
  comentario text,
  itens jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (loja_id, user_id, tipo)
);
create index estoque_rascunhos_user_idx on public.estoque_rascunhos (user_id);
alter table public.estoque_rascunhos enable row level security;
create policy rascunhos_proprios on public.estoque_rascunhos for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.acessa_loja(loja_id));
grant select, insert, update, delete on public.estoque_rascunhos to authenticated;

-- Confirma o lançamento: grava os movimentos e apaga o rascunho na mesma transação (sem lançar em dobro).
-- INVOKER: os inserts passam pela policy estoque_insert. Inventário guarda o snapshot do período.
create function public.confirmar_movimento(p_loja_id bigint, p_tipo text, p_itens jsonb, p_comentario text)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_n integer;
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

  insert into public.estoque_movimentos (produto_id, tipo, quantidade, comentario, saldo_anterior, entradas, saidas)
  select (i->>'produto_id')::bigint, p_tipo, (i->>'quantidade')::int, nullif(btrim(p_comentario), ''),
         case when p_tipo = 'inventario' then e.saldo_inventario end,
         case when p_tipo = 'inventario' then e.entradas end,
         case when p_tipo = 'inventario' then e.amostras + e.outras_saidas + e.vendidos end
  from jsonb_array_elements(p_itens) i
  left join public.estoque_loja(p_loja_id) e on e.produto_id = (i->>'produto_id')::bigint;
  get diagnostics v_n = row_count;

  delete from public.estoque_rascunhos
  where loja_id = p_loja_id and user_id = (select auth.uid()) and tipo = p_tipo;
  return v_n;
end $$;
revoke all on function public.confirmar_movimento(bigint, text, jsonb, text) from public, anon;
grant execute on function public.confirmar_movimento(bigint, text, jsonb, text) to authenticated;
