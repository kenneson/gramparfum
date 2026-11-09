-- Anulação de venda: motivo obrigatório + quem autorizou (chefe+) e quando, para o Histórico e o Fechamento do dia.
-- O estoque volta sozinho (estoque_loja ignora vendas anuladas).
-- Troca de vendedor em pedido ainda não pago (carrinho ou cliente salvo).

alter table public.vendas
  add column anulada_por uuid references public.profiles,
  add column anulada_em timestamptz,
  add column motivo_anulacao text;
create index vendas_anulada_por_idx on public.vendas (anulada_por);

-- mesma regra de texto do app; o "obrigatório" fica em anular_venda (venda normal não tem motivo)
create trigger vendas_textos before update of motivo_anulacao on public.vendas
  for each row execute function private.validar_textos('motivo_anulacao:500:opcional:Motivo');

drop function public.anular_venda(bigint);
create function public.anular_venda(p_venda_id bigint, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.vendas;
  v_motivo text;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if not coalesce(private.meu_role() >= 90 and private.acessa_loja(v.loja_id), false) then
    raise exception 'Anulação só com autorização de chefe de loja ou administração';
  end if;
  if v.anulada then return; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Motivo: campo obrigatório'; end if;

  update public.vendas
  set anulada = true, anulada_por = (select auth.uid()), anulada_em = now(), motivo_anulacao = p_motivo
  where id = p_venda_id
  returning motivo_anulacao into v_motivo; -- já limpo pelo trigger

  insert into public.eventos (tipo, venda_id, descricao, user_id)
  values ('anulacao', p_venda_id,
          format('Venda %s de %s (vendedor %s, total %s) anulada por %s. Produtos devolvidos: %s. Motivo: %s',
                 p_venda_id,
                 to_char(v.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 (select nome from public.profiles where id = v.vendedor_id),
                 v.total,
                 (select nome from public.profiles where id = (select auth.uid())),
                 (select string_agg(format('%s× %s', i.quantidade, pr.nome), ', ' order by i.id)
                  from public.venda_itens i join public.produtos pr on pr.id = i.produto_id
                  where i.venda_id = p_venda_id),
                 v_motivo),
          (select auth.uid()));
end $$;
revoke all on function public.anular_venda(bigint, text) from public, anon;
grant execute on function public.anular_venda(bigint, text) to authenticated;

-- relatorio_vendas: + anulacao {motivo, por, em}
create or replace function public.relatorio_vendas(p_loja_id bigint, p_de date, p_ate date)
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
           'anulacao', case when v.anulada then jsonb_build_object(
             'motivo', v.motivo_anulacao, 'por', an.nome, 'em', v.anulada_em) end,
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
  left join public.profiles an on an.id = v.anulada_por
  where v.loja_id = p_loja_id
    and private.acessa_loja(p_loja_id)
    and (ctx.role >= 90 or v.vendedor_id = (select auth.uid()))
    and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
    and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
$$;

-- ───────────────────────── Pedido não pago: trocar vendedor ─────────────────────────
-- INVOKER: a RLS de pedidos vale. Cliente salvo só muda de dono. Carrinho: se o destino já tem carrinho,
-- os itens vão para ele (um carrinho por vendedor). Retorna o pedido final.
create function public.trocar_vendedor_pedido(p_pedido_id bigint, p_vendedor_id uuid)
returns bigint
language plpgsql set search_path = '' as $$
declare
  p public.pedidos;
  v_destino bigint;
begin
  if coalesce(private.meu_role(), 0) < 90 then
    raise exception 'Troca de vendedor só por chefe de loja ou administração';
  end if;
  select * into p from public.pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if p.vendedor_id = p_vendedor_id then return p.id; end if;
  if not exists (select 1 from public.loja_membros m join public.profiles pf on pf.id = m.user_id
                 where m.loja_id = p.loja_id and m.user_id = p_vendedor_id and m.ativo and pf.ativo) then
    raise exception 'Vendedor inativo ou de outra loja';
  end if;

  if p.nome is null then
    select id into v_destino from public.pedidos
    where loja_id = p.loja_id and vendedor_id = p_vendedor_id and nome is null for update;
  end if;
  if v_destino is null then
    update public.pedidos set vendedor_id = p_vendedor_id where id = p_pedido_id;
    return p_pedido_id;
  end if;

  update public.pedido_itens set pedido_id = v_destino where pedido_id = p_pedido_id;
  delete from public.pedidos where id = p_pedido_id;
  return v_destino;
end $$;
revoke all on function public.trocar_vendedor_pedido(bigint, uuid) from public, anon;
grant execute on function public.trocar_vendedor_pedido(bigint, uuid) to authenticated;
