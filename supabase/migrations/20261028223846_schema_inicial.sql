-- GamParfum — schema inicial (migrado do MySQL legado)
-- Perfis (legado tipoUser): 50 Vendedor, 90 Chefe de loja, 100 Admin geral de lojas, 200 Admin do sistema
-- Formas de pagamento: 1 Pix, 2 Dinheiro, 3 Cartão crédito, 4 Cartão débito, 5 Link de pagamento

create schema if not exists private;

-- ───────────────────────── Tabelas ─────────────────────────

create table public.lojas (
  id bigint generated always as identity primary key,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nome text not null,
  usuario text not null unique check (usuario ~ '^[a-z0-9._-]{3,32}$'),
  role smallint not null default 50 check (role in (50, 90, 100, 200)),
  idioma text not null default 'pt' check (idioma in ('pt', 'es')),
  descricao text,
  acesso_habilitado boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.loja_membros (
  loja_id bigint not null references public.lojas on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (loja_id, user_id)
);
create index loja_membros_user_idx on public.loja_membros (user_id);

create table public.produtos (
  id bigint generated always as identity primary key,
  loja_id bigint not null references public.lojas,
  nome text not null,
  descricao text,
  preco numeric(12, 2) not null default 0 check (preco >= 0),
  valor_combo numeric(12, 2) not null default 0 check (valor_combo >= 0),
  a_venda boolean not null default true,
  ativo boolean not null default true,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create index produtos_loja_idx on public.produtos (loja_id);

-- Pedido em aberto: nome nulo = carrinho atual do vendedor; com nome = pedido salvo
create table public.pedidos (
  id bigint generated always as identity primary key,
  loja_id bigint not null references public.lojas,
  vendedor_id uuid not null references public.profiles,
  nome text,
  descricao text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index pedidos_carrinho_unico on public.pedidos (loja_id, vendedor_id) where nome is null;
create index pedidos_vendedor_idx on public.pedidos (vendedor_id);

create table public.pedido_itens (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos on delete cascade,
  produto_id bigint not null references public.produtos,
  preco numeric(12, 2) not null check (preco >= 0),
  quantidade integer not null default 1 check (quantidade > 0),
  created_at timestamptz not null default now()
);
create index pedido_itens_pedido_idx on public.pedido_itens (pedido_id);
create index pedido_itens_produto_idx on public.pedido_itens (produto_id);

create table public.vendas (
  id bigint generated always as identity primary key,
  loja_id bigint not null references public.lojas,
  vendedor_id uuid not null references public.profiles,
  total numeric(12, 2) not null,
  troco numeric(12, 2) not null default 0,
  anulada boolean not null default false,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create index vendas_loja_data_idx on public.vendas (loja_id, created_at);
create index vendas_vendedor_idx on public.vendas (vendedor_id);

create table public.venda_itens (
  id bigint generated always as identity primary key,
  venda_id bigint not null references public.vendas on delete cascade,
  produto_id bigint not null references public.produtos,
  preco_tabela numeric(12, 2) not null,
  preco numeric(12, 2) not null,
  quantidade integer not null check (quantidade > 0),
  valor_combo numeric(12, 2) not null default 0
);
create index venda_itens_venda_idx on public.venda_itens (venda_id);
create index venda_itens_produto_idx on public.venda_itens (produto_id);

create table public.venda_pagamentos (
  id bigint generated always as identity primary key,
  venda_id bigint not null references public.vendas on delete cascade,
  forma smallint not null check (forma between 1 and 5),
  valor numeric(12, 2) not null check (valor >= 0),
  comentario text
);
create index venda_pagamentos_venda_idx on public.venda_pagamentos (venda_id);

-- Entradas (compras), saídas para amostra e contagens de inventário.
-- Saídas por venda vêm de venda_itens (vendas não anuladas).
create table public.estoque_movimentos (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos,
  tipo text not null check (tipo in ('entrada', 'amostra', 'inventario')),
  quantidade integer not null check (quantidade >= 0),
  saldo_anterior integer, -- snapshot do período, só em 'inventario'
  entradas integer,
  saidas integer,
  comentario text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create index estoque_mov_produto_idx on public.estoque_movimentos (produto_id, tipo, created_at desc);

create table public.eventos (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('troca_vendedor', 'anulacao')),
  venda_id bigint references public.vendas,
  descricao text not null,
  user_id uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
create index eventos_venda_idx on public.eventos (venda_id);
create index eventos_user_idx on public.eventos (user_id);

create table public.acessos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  ip text,
  entrada timestamptz not null default now(),
  saida timestamptz
);
create index acessos_user_idx on public.acessos (user_id, entrada desc);

-- FKs created_by / user_id: índices para joins e deletes
create index produtos_created_by_idx on public.produtos (created_by);
create index pedidos_created_by_idx on public.pedidos (created_by);
create index vendas_created_by_idx on public.vendas (created_by);
create index estoque_mov_created_by_idx on public.estoque_movimentos (created_by);

-- ───────────────────────── Helpers de autorização (schema privado, fora da API) ─────────────────────────

create function private.meu_role() returns smallint
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and ativo
$$;

create function private.acessa_loja(p_loja bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.meu_role() = 200, false)
    or exists (
      select 1 from public.loja_membros m
      where m.loja_id = p_loja and m.user_id = (select auth.uid()) and m.ativo
    )
$$;

revoke all on function private.meu_role(), private.acessa_loja(bigint) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.meu_role(), private.acessa_loja(bigint) to authenticated;

-- ───────────────────────── RLS ─────────────────────────

alter table public.lojas enable row level security;
alter table public.profiles enable row level security;
alter table public.loja_membros enable row level security;
alter table public.produtos enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;
alter table public.vendas enable row level security;
alter table public.venda_itens enable row level security;
alter table public.venda_pagamentos enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.eventos enable row level security;
alter table public.acessos enable row level security;

-- Lojas: visíveis para membros; só admin do sistema cria/edita
create policy lojas_select on public.lojas for select to authenticated
  using (private.acessa_loja(id));
create policy lojas_insert on public.lojas for insert to authenticated
  with check (private.meu_role() = 200);
create policy lojas_update on public.lojas for update to authenticated
  using (private.meu_role() = 200) with check (private.meu_role() = 200);

-- Perfis: o próprio, colegas de loja, ou tudo para admin do sistema.
-- Escrita só do idioma pelo próprio usuário; o resto via server actions (service role).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.meu_role() = 200
    or exists (select 1 from public.loja_membros m where m.user_id = profiles.id and private.acessa_loja(m.loja_id))
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy loja_membros_select on public.loja_membros for select to authenticated
  using (user_id = (select auth.uid()) or private.acessa_loja(loja_id));

-- Produtos: leitura por loja; escrita por admin de lojas (>=100)
create policy produtos_select on public.produtos for select to authenticated
  using (private.acessa_loja(loja_id));
create policy produtos_insert on public.produtos for insert to authenticated
  with check (private.meu_role() >= 100 and private.acessa_loja(loja_id));
create policy produtos_update on public.produtos for update to authenticated
  using (private.meu_role() >= 100 and private.acessa_loja(loja_id))
  with check (private.meu_role() >= 100 and private.acessa_loja(loja_id));

-- Pedidos/carrinho: vendedor só os próprios; chefe+ todos da loja
create policy pedidos_all on public.pedidos for all to authenticated
  using (private.acessa_loja(loja_id) and (private.meu_role() >= 90 or vendedor_id = (select auth.uid())))
  with check (private.acessa_loja(loja_id) and (private.meu_role() >= 90 or vendedor_id = (select auth.uid())));
create policy pedido_itens_all on public.pedido_itens for all to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id))
  with check (exists (select 1 from public.pedidos p where p.id = pedido_id));

-- Vendas: só leitura; escrita exclusiva pelas funções auditadas abaixo
create policy vendas_select on public.vendas for select to authenticated
  using (private.acessa_loja(loja_id) and (private.meu_role() >= 90 or vendedor_id = (select auth.uid())));
create policy venda_itens_select on public.venda_itens for select to authenticated
  using (exists (select 1 from public.vendas v where v.id = venda_id));
create policy venda_pagamentos_select on public.venda_pagamentos for select to authenticated
  using (exists (select 1 from public.vendas v where v.id = venda_id));

-- Estoque: leitura por loja; lançamentos por chefe+
create policy estoque_select on public.estoque_movimentos for select to authenticated
  using (exists (select 1 from public.produtos p where p.id = produto_id));
create policy estoque_insert on public.estoque_movimentos for insert to authenticated
  with check (private.meu_role() >= 90 and created_by = (select auth.uid())
    and exists (select 1 from public.produtos p where p.id = produto_id));
create policy estoque_update on public.estoque_movimentos for update to authenticated
  using (private.meu_role() >= 90 and created_by = (select auth.uid()))
  with check (private.meu_role() >= 90 and created_by = (select auth.uid()));

create policy eventos_select on public.eventos for select to authenticated
  using (private.meu_role() >= 90);

create policy acessos_select on public.acessos for select to authenticated
  using (user_id = (select auth.uid()) or private.meu_role() >= 90);
create policy acessos_insert on public.acessos for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy acessos_update on public.acessos for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── Grants (explícitos: não depender do auto-expose da Data API) ─────────────────────────

revoke all on all tables in schema public from anon;
grant select on public.lojas, public.profiles, public.loja_membros, public.produtos,
  public.vendas, public.venda_itens, public.venda_pagamentos, public.estoque_movimentos,
  public.eventos, public.acessos to authenticated;
grant insert, update on public.lojas, public.produtos, public.estoque_movimentos, public.acessos to authenticated;
grant select, insert, update, delete on public.pedidos, public.pedido_itens to authenticated;
revoke update on public.profiles from authenticated;
grant update (idioma) on public.profiles to authenticated;

-- ───────────────────────── Funções de negócio ─────────────────────────
-- SECURITY DEFINER de propósito: vendas só podem ser gravadas/alteradas por estas funções,
-- que validam permissão (auth.uid()) e registram eventos. Sem policies de escrita nas tabelas de venda.

create function public.finalizar_venda(p_pedido_id bigint, p_pagamentos jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_ped public.pedidos;
  v_total numeric;
  v_pago numeric;
  v_dinheiro numeric;
  v_troco numeric;
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

  select coalesce(sum((p->>'valor')::numeric), 0),
         coalesce(sum((p->>'valor')::numeric) filter (where (p->>'forma')::int = 2), 0)
    into v_pago, v_dinheiro
  from jsonb_array_elements(p_pagamentos) p;

  v_troco := v_pago - v_total;
  if v_troco < 0 then raise exception 'Pagamento insuficiente'; end if;
  if v_troco > v_dinheiro then raise exception 'Troco só pode sair de pagamento em dinheiro'; end if;

  insert into public.vendas (loja_id, vendedor_id, total, troco, created_by)
  values (v_ped.loja_id, v_ped.vendedor_id, v_total, v_troco, (select auth.uid()))
  returning id into v_venda;

  insert into public.venda_itens (venda_id, produto_id, preco_tabela, preco, quantidade, valor_combo)
  select v_venda, i.produto_id, pr.preco, i.preco, i.quantidade, pr.valor_combo
  from public.pedido_itens i join public.produtos pr on pr.id = i.produto_id
  where i.pedido_id = p_pedido_id;

  insert into public.venda_pagamentos (venda_id, forma, valor, comentario)
  select v_venda, (p->>'forma')::smallint, (p->>'valor')::numeric, nullif(p->>'comentario', '')
  from jsonb_array_elements(p_pagamentos) p
  where (p->>'forma')::int <> 2;

  -- dinheiro consolidado em uma linha, já líquido do troco (o que fica no caixa)
  if v_dinheiro > 0 then
    insert into public.venda_pagamentos (venda_id, forma, valor, comentario)
    select v_venda, 2, v_dinheiro - v_troco, string_agg(nullif(p->>'comentario', ''), '; ')
    from jsonb_array_elements(p_pagamentos) p
    where (p->>'forma')::int = 2;
  end if;

  delete from public.pedidos where id = p_pedido_id;
  return v_venda;
end $$;

create function public.anular_venda(p_venda_id bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.vendas;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  if not (private.meu_role() >= 90 and private.acessa_loja(v.loja_id)) then raise exception 'Sem permissão'; end if;
  if v.anulada then return; end if;

  update public.vendas set anulada = true where id = p_venda_id;
  insert into public.eventos (tipo, venda_id, descricao, user_id)
  values ('anulacao', p_venda_id,
          format('Venda %s anulada por %s', p_venda_id,
                 (select nome from public.profiles where id = (select auth.uid()))),
          (select auth.uid()));
end $$;

create function public.trocar_vendedor(p_venda_id bigint, p_vendedor_id uuid)
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
  if not exists (select 1 from public.loja_membros where loja_id = v.loja_id and user_id = p_vendedor_id) then
    raise exception 'Vendedor não pertence à loja';
  end if;

  update public.vendas set vendedor_id = p_vendedor_id where id = p_venda_id;
  insert into public.eventos (tipo, venda_id, descricao, user_id)
  values ('troca_vendedor', p_venda_id,
          format('Venda %s: %s → %s', p_venda_id,
                 (select nome from public.profiles where id = v.vendedor_id),
                 (select nome from public.profiles where id = p_vendedor_id)),
          (select auth.uid()));
end $$;

-- Estoque atual por produto da loja: último inventário + entradas − amostras − vendas desde então.
-- DEFINER para enxergar vendas de todos os vendedores (o vendedor só vê as próprias via RLS).
create function public.estoque_loja(p_loja_id bigint)
returns table (
  produto_id bigint,
  ultimo_inventario timestamptz,
  saldo_inventario integer,
  entradas integer,
  amostras integer,
  vendidos integer,
  estoque integer
)
language sql stable security definer set search_path = '' as $$
  select p.id,
         inv.created_at,
         coalesce(inv.quantidade, 0),
         coalesce(m.entradas, 0)::int,
         coalesce(m.amostras, 0)::int,
         coalesce(vd.vendidos, 0)::int,
         (coalesce(inv.quantidade, 0) + coalesce(m.entradas, 0) - coalesce(m.amostras, 0) - coalesce(vd.vendidos, 0))::int
  from public.produtos p
  left join lateral (
    select e.quantidade, e.created_at from public.estoque_movimentos e
    where e.produto_id = p.id and e.tipo = 'inventario'
    order by e.created_at desc limit 1
  ) inv on true
  left join lateral (
    select sum(e.quantidade) filter (where e.tipo = 'entrada') as entradas,
           sum(e.quantidade) filter (where e.tipo = 'amostra') as amostras
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

revoke all on function public.finalizar_venda(bigint, jsonb), public.anular_venda(bigint),
  public.trocar_vendedor(bigint, uuid), public.estoque_loja(bigint) from public, anon;
grant execute on function public.finalizar_venda(bigint, jsonb), public.anular_venda(bigint),
  public.trocar_vendedor(bigint, uuid), public.estoque_loja(bigint) to authenticated;
