-- Edição de vendas (chefe+) e restrição de faturamento por perfil.
-- Estoque continua derivado de venda_itens (estoque_loja): editar/anular venda já atualiza o saldo.

alter table public.eventos drop constraint eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check check (tipo in ('troca_vendedor', 'anulacao', 'edicao'));

-- ───────────────────────── Pagamentos (regra única para finalizar e editar) ─────────────────────────
-- Substitui os pagamentos da venda; paga tudo, troco só sai de dinheiro. Retorna o troco.
-- Sem DEFINER: só é chamada de dentro das funções DEFINER abaixo.
create function private.gravar_pagamentos(p_venda_id bigint, p_total numeric, p_pagamentos jsonb)
returns numeric
language plpgsql set search_path = '' as $$
declare
  v_pago numeric;
  v_dinheiro numeric;
  v_troco numeric;
begin
  select coalesce(sum((p->>'valor')::numeric), 0),
         coalesce(sum((p->>'valor')::numeric) filter (where (p->>'forma')::int = 2), 0)
    into v_pago, v_dinheiro
  from jsonb_array_elements(p_pagamentos) p;

  v_troco := v_pago - p_total;
  if v_troco < 0 then raise exception 'Pagamento insuficiente'; end if;
  if v_troco > v_dinheiro then raise exception 'Troco só pode sair de pagamento em dinheiro'; end if;

  delete from public.venda_pagamentos where venda_id = p_venda_id;

  insert into public.venda_pagamentos (venda_id, forma, valor, comentario)
  select p_venda_id, (p->>'forma')::smallint, (p->>'valor')::numeric, nullif(p->>'comentario', '')
  from jsonb_array_elements(p_pagamentos) p
  where (p->>'forma')::int <> 2;

  -- dinheiro consolidado em uma linha, já líquido do troco (o que fica no caixa)
  if v_dinheiro > 0 then
    insert into public.venda_pagamentos (venda_id, forma, valor, comentario)
    select p_venda_id, 2, v_dinheiro - v_troco, string_agg(nullif(p->>'comentario', ''), '; ')
    from jsonb_array_elements(p_pagamentos) p
    where (p->>'forma')::int = 2;
  end if;

  return v_troco;
end $$;
revoke all on function private.gravar_pagamentos(bigint, numeric, jsonb) from public, anon, authenticated;

create or replace function public.finalizar_venda(p_pedido_id bigint, p_pagamentos jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos;
  v_total numeric;
  v_venda bigint;
begin
  select * into v_ped from public.pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if not (private.acessa_loja(v_ped.loja_id)
          and (private.meu_role() >= 90 or v_ped.vendedor_id = (select auth.uid()))) then
    raise exception 'Sem permissão';
  end if;
  if not exists (select 1 from public.pedido_itens where pedido_id = p_pedido_id) then
    raise exception 'Pedido vazio';
  end if;

  select coalesce(sum(preco * quantidade), 0) into v_total
  from public.pedido_itens where pedido_id = p_pedido_id;

  insert into public.vendas (loja_id, vendedor_id, total, created_by)
  values (v_ped.loja_id, v_ped.vendedor_id, v_total, (select auth.uid()))
  returning id into v_venda;

  insert into public.venda_itens (venda_id, produto_id, preco_tabela, preco, quantidade, valor_combo)
  select v_venda, i.produto_id, pr.preco, i.preco, i.quantidade, pr.valor_combo
  from public.pedido_itens i join public.produtos pr on pr.id = i.produto_id
  where i.pedido_id = p_pedido_id;

  update public.vendas set troco = private.gravar_pagamentos(v_venda, v_total, p_pagamentos) where id = v_venda;

  delete from public.pedidos where id = p_pedido_id;
  return v_venda;
end $$;

-- p_itens: [{produto_id, preco, quantidade}]. Produto que já estava na venda mantém preço de tabela e combo
-- da época; produto novo pega os valores atuais do cadastro.
create function public.editar_venda(p_venda_id bigint, p_itens jsonb, p_pagamentos jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.vendas;
  v_total numeric;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if not (private.meu_role() >= 90 and private.acessa_loja(v.loja_id)) then raise exception 'Sem permissão'; end if;
  if v.anulada then raise exception 'Venda anulada'; end if;
  if coalesce(jsonb_array_length(p_itens), 0) = 0 then raise exception 'Venda sem produtos'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_itens) i
    left join public.produtos pr on pr.id = (i->>'produto_id')::bigint and pr.loja_id = v.loja_id
    where pr.id is null or (i->>'preco')::numeric < 0 or (i->>'quantidade')::int <= 0
  ) then
    raise exception 'Produto, preço ou quantidade inválidos';
  end if;

  with antigos as (
    select distinct on (produto_id) produto_id, preco_tabela, valor_combo
    from public.venda_itens where venda_id = p_venda_id order by produto_id, id
  ), apagados as (
    delete from public.venda_itens where venda_id = p_venda_id
  )
  insert into public.venda_itens (venda_id, produto_id, preco_tabela, preco, quantidade, valor_combo)
  select p_venda_id, pr.id, coalesce(a.preco_tabela, pr.preco), (i->>'preco')::numeric, (i->>'quantidade')::int,
         coalesce(a.valor_combo, pr.valor_combo)
  from jsonb_array_elements(p_itens) i
  join public.produtos pr on pr.id = (i->>'produto_id')::bigint
  left join antigos a on a.produto_id = pr.id;

  select sum((i->>'preco')::numeric * (i->>'quantidade')::int) into v_total from jsonb_array_elements(p_itens) i;

  update public.vendas
  set total = v_total, troco = private.gravar_pagamentos(p_venda_id, v_total, p_pagamentos)
  where id = p_venda_id;

  insert into public.eventos (tipo, venda_id, descricao, user_id)
  values ('edicao', p_venda_id,
          format('Venda %s editada por %s (total %s → %s)', p_venda_id,
                 (select nome from public.profiles where id = (select auth.uid())), v.total, v_total),
          (select auth.uid()));
end $$;

revoke all on function public.editar_venda(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.editar_venda(bigint, jsonb, jsonb) to authenticated;

-- ───────────────────────── Restrição de faturamento ─────────────────────────
-- Valores (total, troco, preços, pagamentos) saem só por relatorio_vendas. Leitura direta das tabelas
-- fica com as colunas sem valor (o inventário usa quantidades/datas).
revoke select on public.vendas, public.venda_itens, public.venda_pagamentos from authenticated;
grant select (id, loja_id, vendedor_id, anulada, created_by, created_at) on public.vendas to authenticated;
grant select (id, venda_id, produto_id, quantidade, valor_combo) on public.venda_itens to authenticated;

-- Admin (>= 100): tudo, qualquer período.
-- Vendedor/chefe: um dia = detalhe completo do dia; vários dias = sem total, sem preços e só pagamentos em dinheiro.
-- Período em dias de São Paulo, inclusivo.
create function public.relatorio_vendas(p_loja_id bigint, p_de date, p_ate date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with ctx as (
    select private.meu_role() as role,
           coalesce(private.meu_role() >= 100, false) or p_de = p_ate as completo
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id,
           'created_at', v.created_at,
           'anulada', v.anulada,
           'vendedor_id', v.vendedor_id,
           'total', case when ctx.completo then v.total end,
           'troco', case when ctx.completo then v.troco end,
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
           'venda_pagamentos', (
             select coalesce(jsonb_agg(jsonb_build_object('forma', g.forma, 'valor', g.valor, 'comentario', g.comentario)
                                       order by g.id), '[]'::jsonb)
             from public.venda_pagamentos g
             where g.venda_id = v.id and (ctx.completo or g.forma = 2))
         ) order by v.created_at), '[]'::jsonb)
  from ctx
  cross join public.vendas v
  join public.profiles vd on vd.id = v.vendedor_id
  left join public.profiles op on op.id = v.created_by
  where v.loja_id = p_loja_id
    and private.acessa_loja(p_loja_id)
    and (ctx.role >= 90 or v.vendedor_id = (select auth.uid()))
    and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
    and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
$$;

revoke all on function public.relatorio_vendas(bigint, date, date) from public, anon;
grant execute on function public.relatorio_vendas(bigint, date, date) to authenticated;
