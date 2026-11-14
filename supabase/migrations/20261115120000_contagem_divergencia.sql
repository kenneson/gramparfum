-- Contagem diferente do esperado (para menos OU para mais):
--   1. só é registrada com explicação (comentário obrigatório), também para quem conta "às cegas";
--   2. fica pendente em Recuperados até a administração resolver. Sobra (contou mais do que o sistema esperava,
--      ex.: venda não registrada ou compra não lançada) só se resolve aceitando a diferença com explicação.
-- O estoque passa a ser o contado (é o que está na prateleira); a diferença continua apontada até ser resolvida.

create or replace function public.confirmar_movimento(p_loja_id bigint, p_tipo text, p_itens jsonb, p_comentario text)
returns bigint[]
language plpgsql set search_path = '' as $$
declare
  v_ids bigint[];
  v_difs integer;
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

  if p_tipo = 'inventario' and nullif(btrim(p_comentario), '') is null then
    select count(*) into v_difs
    from jsonb_array_elements(p_itens) i
    join public.estoque_loja(p_loja_id) e on e.produto_id = (i->>'produto_id')::bigint
    where (i->>'quantidade')::int <> e.estoque;
    if v_difs > 0 then
      raise exception 'A contagem não bate com o estoque em % produto(s). Confira de novo e, se estiver certa, explique a diferença no comentário', v_difs;
    end if;
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

-- diferenca = contado − esperado (negativo = faltou, positivo = sobrou); resolvido em unidades
drop function public.divergencias_loja(bigint);
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
revoke all on function public.divergencias_loja(bigint) from public, anon;
grant execute on function public.divergencias_loja(bigint) to authenticated;

-- Falta: cobrar valor, produto voltou ou aceitar. Sobra: só aceitar (com explicação).
create or replace function public.registrar_recuperacao(p_movimento_id bigint, p_tipo text, p_quantidade integer,
                                                        p_valor numeric, p_forma smallint, p_responsavel uuid, p_comentario text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_id bigint;
begin
  if coalesce(private.meu_role(), 0) < 100 then raise exception 'Só a administração registra recuperações'; end if;
  select e.id, e.produto_id, e.created_at, p.loja_id, p.nome,
         (e.quantidade - (coalesce(e.saldo_anterior, 0) + coalesce(e.entradas, 0) - coalesce(e.saidas, 0))) as dif,
         coalesce((select sum(r.quantidade) from public.recuperacoes r
                   where r.movimento_id = e.id and r.desfeita_em is null), 0) as resolvido
    into d
  from public.estoque_movimentos e join public.produtos p on p.id = e.produto_id
  where e.id = p_movimento_id and e.tipo = 'inventario';
  if not found or not private.acessa_loja(d.loja_id) then raise exception 'Contagem não encontrada'; end if;
  if p_tipo is null or p_tipo not in ('valor', 'produto', 'acerto') then raise exception 'Tipo inválido'; end if;
  if d.dif > 0 and p_tipo <> 'acerto' then
    raise exception 'Contagem com sobra: só dá para aceitar a diferença, explicando o motivo';
  end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > abs(d.dif) - d.resolvido then
    raise exception 'Quantidade maior do que a diferença pendente (%)', greatest(abs(d.dif) - d.resolvido, 0);
  end if;
  if p_tipo = 'valor' and (p_valor is null or p_valor <= 0) then raise exception 'Informe o valor recebido'; end if;
  if p_tipo = 'valor' and (p_forma is null or p_forma not between 1 and 5) then
    raise exception 'Informe a forma de pagamento';
  end if;
  if p_tipo = 'valor' and p_responsavel is null then raise exception 'Informe a pessoa'; end if;
  if p_tipo = 'acerto' and d.dif < 0 and p_responsavel is null then raise exception 'Informe a pessoa'; end if;
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
          format('%s: %s× %s (%s na contagem de %s), registrado por %s%s%s',
                 case p_tipo when 'valor' then format('Valor cobrado (%s, forma %s)', p_valor, p_forma)
                             when 'produto' then 'Produto voltou ao estoque'
                             else 'Diferença aceita' end,
                 p_quantidade, d.nome,
                 case when d.dif < 0 then 'falta' else 'sobra' end,
                 to_char(d.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
                 (select nome from public.profiles where id = (select auth.uid())),
                 coalesce(' · pessoa: ' || (select nome from public.profiles where id = p_responsavel), ''),
                 coalesce(' · ' || (select comentario from public.recuperacoes where id = v_id), '')),
          (select auth.uid()));
  return v_id;
end $$;
