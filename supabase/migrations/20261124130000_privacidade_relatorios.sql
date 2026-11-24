-- Privacidade nos relatórios: o admin do sistema (200) marca vendedores de uma loja como privativos.
-- Enquanto marcados, as vendas deles (nome, vendas, valores por forma) saem do Detalhado, do Fechamento do dia
-- e dos totais da loja para todos abaixo do 200. Combos, Produtos e Ranking (só quantidades) não mudam.
-- A própria pessoa continua vendo as próprias vendas no Detalhado (não no Fechamento da loja).

create table public.privacidade (
  loja_id bigint not null references public.lojas on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (loja_id, user_id)
);
create index privacidade_user_idx on public.privacidade (user_id);
create index privacidade_created_by_idx on public.privacidade (created_by);
alter table public.privacidade enable row level security;
-- só o admin do sistema sabe quem está marcado; escrita só por definir_privacidade
create policy privacidade_select on public.privacidade for select to authenticated
  using (coalesce(private.meu_role() = 200, false));
grant select on public.privacidade to authenticated;
create trigger auditar after insert or update or delete on public.privacidade
  for each row execute function private.auditar();

-- true = esconder esta venda de quem está consultando
create function private.privativo(p_loja bigint, p_vendedor uuid, p_loja_toda boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.meu_role() < 200, true)
     and (p_loja_toda or p_vendedor is distinct from (select auth.uid()))
     and exists (select 1 from public.privacidade p where p.loja_id = p_loja and p.user_id = p_vendedor)
$$;
revoke all on function private.privativo(bigint, uuid, boolean) from public, anon;
grant execute on function private.privativo(bigint, uuid, boolean) to authenticated;

-- Substitui a lista de privativos da loja (só admin do sistema)
create function public.definir_privacidade(p_loja_id bigint, p_user_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(private.meu_role(), 0) < 200 then
    raise exception 'Só o administrador do sistema define a privacidade';
  end if;
  if exists (select 1 from unnest(coalesce(p_user_ids, '{}')) u(id)
             where not exists (select 1 from public.loja_membros m where m.loja_id = p_loja_id and m.user_id = u.id)) then
    raise exception 'Pessoa não é da loja';
  end if;
  delete from public.privacidade
  where loja_id = p_loja_id and user_id <> all (coalesce(p_user_ids, '{}'));
  insert into public.privacidade (loja_id, user_id)
  select p_loja_id, u.id from unnest(coalesce(p_user_ids, '{}')) u(id)
  on conflict do nothing;
end $$;
revoke all on function public.definir_privacidade(bigint, uuid[]) from public, anon;
grant execute on function public.definir_privacidade(bigint, uuid[]) to authenticated;

create or replace function public.relatorio_vendas(p_loja_id bigint, p_de date, p_ate date, p_loja_toda boolean default false)
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
    and (ctx.role >= 90 or v.vendedor_id = (select auth.uid()) or (p_loja_toda and ctx.completo))
    and not private.privativo(v.loja_id, v.vendedor_id, p_loja_toda)
    and v.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
    and v.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'
$$;

create or replace function public.relatorio_caixa(p_loja_id bigint, p_de date, p_ate date, p_loja_toda boolean default false)
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
        and (ctx.role >= 90 or d.created_by = (select auth.uid()) or v.vendedor_id = (select auth.uid())
             or (p_loja_toda and ctx.completo))
        and not private.privativo(d.loja_id, v.vendedor_id, p_loja_toda)
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
      where ctx.completo and (ctx.role >= 90 or p_loja_toda)
        and r.loja_id = p_loja_id and r.desfeita_em is null
        and (ctx.role >= 100 or r.tipo = 'valor')
        and r.created_at >= p_de::timestamp at time zone 'America/Sao_Paulo'
        and r.created_at < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
  from ctx
  where private.acessa_loja(p_loja_id)
$$;
