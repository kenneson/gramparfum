-- Ajuste pedido pelo cliente:
--   * o aviso de diferença de contagem pendente aparece NA CONTAGEM para todo perfil (vendedor e chefe também):
--     pendencias_produtos() devolve, por produto, só as unidades que faltam/sobram (sem nomes, preços ou explicações);
--   * o alerta ao entrar no sistema e a lista detalhada voltam a ser só da administração (>= 100).

create function public.pendencias_produtos(p_loja_id bigint)
returns table (produto_id bigint, faltam integer, sobram integer)
language sql stable security definer set search_path = '' as $$
  with d as (
    select e.produto_id,
           e.quantidade - (coalesce(e.saldo_anterior, 0) + coalesce(e.entradas, 0) - coalesce(e.saidas, 0)) as dif,
           coalesce((select sum(r.quantidade) from public.recuperacoes r
                     where r.movimento_id = e.id and r.desfeita_em is null), 0) as resolvido
    from public.estoque_movimentos e
    join public.produtos p on p.id = e.produto_id
    where p.loja_id = p_loja_id and e.tipo = 'inventario'
      and e.created_at >= timestamptz '2026-11-14 00:00:00-03'
  )
  select d.produto_id,
         coalesce(sum(abs(d.dif) - d.resolvido) filter (where d.dif < 0), 0)::int,
         coalesce(sum(abs(d.dif) - d.resolvido) filter (where d.dif > 0), 0)::int
  from d
  where d.dif <> 0 and abs(d.dif) - d.resolvido > 0
    and private.meu_role() is not null and private.acessa_loja(p_loja_id)
  group by d.produto_id
$$;
revoke all on function public.pendencias_produtos(bigint) from public, anon;
grant execute on function public.pendencias_produtos(bigint) to authenticated;

create or replace function public.divergencias_loja(p_loja_id bigint)
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
  diferenca integer,
  resolvido integer,
  explicacao text
)
language sql stable security definer set search_path = '' as $$
  select e.id, p.id, p.nome, p.preco, e.created_at, pf.nome, e.created_by,
         x.esperado, e.quantidade, e.quantidade - x.esperado,
         coalesce((select sum(r.quantidade) from public.recuperacoes r
                   where r.movimento_id = e.id and r.desfeita_em is null), 0)::int,
         e.comentario
  from public.estoque_movimentos e
  join public.produtos p on p.id = e.produto_id
  left join public.profiles pf on pf.id = e.created_by
  cross join lateral (
    select (coalesce(e.saldo_anterior, 0) + coalesce(e.entradas, 0) - coalesce(e.saidas, 0))::int as esperado
  ) x
  where p.loja_id = p_loja_id and e.tipo = 'inventario'
    -- ponytail: contagens do sistema antigo (importadas) ficam fora; trocar por uma data móvel se a lista crescer
    and e.created_at >= timestamptz '2026-11-14 00:00:00-03'
    and x.esperado <> e.quantidade
    and coalesce(private.meu_role() >= 100, false) and private.acessa_loja(p_loja_id)
  order by e.created_at desc
$$;

create or replace function public.pendencias_estoque()
returns table (loja_id bigint, loja text, produtos integer, faltam integer, sobram integer, desde timestamptz)
language sql stable security definer set search_path = '' as $$
  with d as (
    select p.loja_id, e.produto_id, e.created_at,
           e.quantidade - (coalesce(e.saldo_anterior, 0) + coalesce(e.entradas, 0) - coalesce(e.saidas, 0)) as dif,
           coalesce((select sum(r.quantidade) from public.recuperacoes r
                     where r.movimento_id = e.id and r.desfeita_em is null), 0) as resolvido
    from public.estoque_movimentos e
    join public.produtos p on p.id = e.produto_id
    where e.tipo = 'inventario' and e.created_at >= timestamptz '2026-11-14 00:00:00-03'
  ),
  pend as (
    select d.loja_id, d.produto_id, d.created_at, d.dif, abs(d.dif) - d.resolvido as pendente
    from d where d.dif <> 0 and abs(d.dif) - d.resolvido > 0
  )
  select l.id, l.nome, count(distinct pend.produto_id)::int,
         coalesce(sum(pend.pendente) filter (where pend.dif < 0), 0)::int,
         coalesce(sum(pend.pendente) filter (where pend.dif > 0), 0)::int,
         min(pend.created_at)
  from pend
  join public.lojas l on l.id = pend.loja_id
  where coalesce(private.meu_role() >= 100, false) and private.acessa_loja(l.id)
  group by l.id, l.nome
  order by l.nome
$$;
