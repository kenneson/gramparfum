-- Relatório de combos da equipe: todo perfil vê os combos de todos os vendedores da loja no período.
-- Só quantidades (combos e número de vendas), nenhum valor em R$ — a regra de faturamento continua no relatorio_vendas.
-- Mesma conta do ranking: vendas não anuladas, menos devoluções com valor devolvido (na data da devolução).
-- Diferente do ranking, entra quem vendeu no período mesmo que hoje esteja inativo ou fora da loja.
create function public.relatorio_combos(p_loja_id bigint, p_de date, p_ate date)
returns table (vendedor_id uuid, nome text, combos numeric, vendas integer)
language sql stable security definer set search_path = '' as $$
  with periodo as (
    select p_de::timestamp at time zone 'America/Sao_Paulo' as ini,
           (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo' as fim
  ),
  vend as (
    select v.vendedor_id, sum(i.valor_combo * i.quantidade) as combos, count(distinct v.id) as vendas
    from periodo
    cross join public.vendas v
    join public.venda_itens i on i.venda_id = v.id
    where v.loja_id = p_loja_id and not v.anulada
      and v.created_at >= periodo.ini and v.created_at < periodo.fim
    group by v.vendedor_id
  ),
  dev as (
    select v.vendedor_id, sum(di.valor_combo * di.quantidade) as combos
    from periodo
    cross join public.devolucoes d
    join public.devolucao_itens di on di.devolucao_id = d.id
    join public.vendas v on v.id = d.venda_id
    where d.loja_id = p_loja_id and d.devolve_valor and d.desfeita_em is null
      and d.created_at >= periodo.ini and d.created_at < periodo.fim
    group by v.vendedor_id
  )
  select p.id, p.nome, coalesce(vend.combos, 0) - coalesce(dev.combos, 0), coalesce(vend.vendas, 0)::int
  from vend
  full join dev on dev.vendedor_id = vend.vendedor_id
  join public.profiles p on p.id = coalesce(vend.vendedor_id, dev.vendedor_id)
  where private.acessa_loja(p_loja_id)
  order by 3 desc, p.nome
$$;
revoke all on function public.relatorio_combos(bigint, date, date) from public, anon;
grant execute on function public.relatorio_combos(bigint, date, date) to authenticated;
