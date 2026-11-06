-- Amostras: qualquer membro da loja abre (lança) e edita; inventário e entradas só a Administração (>= 100).
-- Auditoria: quem abriu = created_by; quem editou = editado_por/editado_em + evento 'edicao_amostra'.

alter table public.estoque_movimentos
  add column editado_por uuid references public.profiles,
  add column editado_em timestamptz;
create index estoque_mov_editado_por_idx on public.estoque_movimentos (editado_por);

alter table public.eventos add column movimento_id bigint references public.estoque_movimentos;
create index eventos_movimento_idx on public.eventos (movimento_id);
alter table public.eventos drop constraint eventos_tipo_check;
alter table public.eventos add constraint eventos_tipo_check
  check (tipo in ('troca_vendedor', 'anulacao', 'edicao', 'edicao_amostra'));

-- Lançar: amostra (quantidade > 0) por qualquer perfil ativo da loja; entrada/inventário só admin.
drop policy estoque_insert on public.estoque_movimentos;
create policy estoque_insert on public.estoque_movimentos for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.meu_role() is not null
    and exists (select 1 from public.produtos p where p.id = produto_id)
    and editado_por is null and editado_em is null
    and ((tipo = 'amostra' and quantidade > 0) or private.meu_role() >= 100)
  );

-- Sem UPDATE direto: edição só por editar_amostra (registra quem e o quê)
drop policy estoque_update on public.estoque_movimentos;
revoke update on public.estoque_movimentos from authenticated;

-- Vendedor edita só as amostras que ele abriu; chefe+ qualquer amostra da loja.
-- Quantidade 0 = amostra cancelada (o registro de quem abriu continua).
create function public.editar_amostra(p_id bigint, p_quantidade integer, p_comentario text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.estoque_movimentos;
  v_produto public.produtos;
  v_comentario text := nullif(btrim(p_comentario), '');
begin
  select * into m from public.estoque_movimentos where id = p_id for update;
  if not found or m.tipo <> 'amostra' then raise exception 'Amostra não encontrada'; end if;
  select * into v_produto from public.produtos where id = m.produto_id;
  if private.meu_role() is null or not private.acessa_loja(v_produto.loja_id) then
    raise exception 'Sem permissão';
  end if;
  if private.meu_role() < 90 and m.created_by is distinct from (select auth.uid()) then
    raise exception 'Vendedor só edita as amostras que abriu';
  end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Quantidade inválida'; end if;
  if p_quantidade = m.quantidade and v_comentario is not distinct from m.comentario then return; end if;

  update public.estoque_movimentos
  set quantidade = p_quantidade, comentario = v_comentario, editado_por = (select auth.uid()), editado_em = now()
  where id = p_id;

  insert into public.eventos (tipo, movimento_id, descricao, user_id)
  values ('edicao_amostra', p_id,
          format('Amostra de %s aberta em %s por %s: %s', v_produto.nome,
                 to_char(m.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 coalesce((select nome from public.profiles where id = m.created_by), '—'),
                 concat_ws('; ',
                   case when p_quantidade <> m.quantidade then
                     case when p_quantidade = 0 then format('cancelada (era %s)', m.quantidade)
                          else format('quantidade %s → %s', m.quantidade, p_quantidade) end end,
                   case when v_comentario is distinct from m.comentario then
                     format('comentário "%s" → "%s"', coalesce(m.comentario, ''), coalesce(v_comentario, '')) end)),
          (select auth.uid()));
end $$;

revoke all on function public.editar_amostra(bigint, integer, text) from public, anon;
grant execute on function public.editar_amostra(bigint, integer, text) to authenticated;
