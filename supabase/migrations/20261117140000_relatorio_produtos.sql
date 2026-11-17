-- Produtos vendidos pela loja no período, para todo perfil (vendedor incluso): só quantidades e combos,
-- nenhum valor em R$ nem forma de pagamento. Mesma conta da aba Produtos da administração (vendas não anuladas).
create function public.relatorio_produtos(p_loja_id bigint, p_de date, p_ate date)
returns table (produto_id bigint, nome text, quantidade integer, combos numeric)
language sql stable security definer set search_path = '' as $$
  select pr.id, pr.nome, sum(i.quantidade)::int, sum(i.valor_combo * i.quantidade)
  from public.vendas v
  join public.venda_itens i on i.venda_id = v.id
  join public.produtos pr on pr.id = i.produto_id
  where v.loja_id = p_loja_id and not v.anulada
    and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
    and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
    and private.acessa_loja(p_loja_id)
  group by pr.id, pr.nome
  order by 3 desc, 2
$$;
revoke all on function public.relatorio_produtos(bigint, date, date) from public, anon;
grant execute on function public.relatorio_produtos(bigint, date, date) to authenticated;
