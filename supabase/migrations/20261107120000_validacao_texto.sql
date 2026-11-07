-- Texto digitado: mesma regra do app (lib/texto.ts), repetida aqui porque a API do Supabase pode ser chamada direto.
--   obrigatório: não vazio e ao menos 3 letras/números
--   opcional:    vazio vira NULL; se preenchido, ao menos 3 letras/números
--   todos:       espaços juntados e pontas cortadas; limite de tamanho
-- Trigger (e não CHECK) para só validar o campo que mudou: dado legado curto não trava outras edições da linha
-- (ex.: trocar o idioma de uma pessoa cujo nome antigo tem 2 letras).
-- Argumentos: 'coluna:max:obrigatorio|opcional:Rótulo'.
-- Fora daqui: estoque_rascunhos (rascunho é salvo enquanto se digita) e venda_pagamentos (só funções gravam).

create function private.validar_textos()
returns trigger
language plpgsql set search_path = '' as $$
declare
  arg text;
  col text;
  max_len integer;
  obrigatorio boolean;
  rotulo text;
  v text;
  novo jsonb := to_jsonb(new);
begin
  foreach arg in array tg_argv loop
    col := split_part(arg, ':', 1);
    max_len := split_part(arg, ':', 2)::integer;
    obrigatorio := split_part(arg, ':', 3) = 'obrigatorio';
    rotulo := split_part(arg, ':', 4);
    v := nullif(btrim(regexp_replace(novo->>col, '\s+', ' ', 'g')), '');

    if tg_op = 'UPDATE'
       and v is not distinct from nullif(btrim(regexp_replace(to_jsonb(old)->>col, '\s+', ' ', 'g')), '') then
      continue; -- campo não mudou
    end if;

    if v is null then
      if obrigatorio then raise exception '%: campo obrigatório', rotulo; end if;
    elsif char_length(regexp_replace(v, '[[:space:][:punct:]]', '', 'g')) < 3 then
      raise exception '%: escreva ao menos 3 letras', rotulo;
    elsif char_length(v) > max_len then
      raise exception '%: no máximo % caracteres', rotulo, max_len;
    end if;

    novo := jsonb_set(novo, array[col], coalesce(to_jsonb(v), 'null'::jsonb));
  end loop;
  return jsonb_populate_record(new, novo);
end $$;
revoke all on function private.validar_textos() from public, anon, authenticated;

create trigger lojas_textos before insert or update of nome on public.lojas
  for each row execute function private.validar_textos('nome:80:obrigatorio:Nome da loja');

create trigger profiles_textos before insert or update of nome, descricao on public.profiles
  for each row execute function private.validar_textos('nome:80:obrigatorio:Nome', 'descricao:500:opcional:Comentário');

create trigger produtos_textos before insert or update of nome, descricao on public.produtos
  for each row execute function private.validar_textos('nome:80:obrigatorio:Nome', 'descricao:500:opcional:Descrição');

create trigger pedidos_textos before insert or update of nome, descricao on public.pedidos
  for each row execute function private.validar_textos('nome:80:opcional:Nome', 'descricao:500:opcional:Descrição');

create trigger estoque_movimentos_textos before insert or update of comentario on public.estoque_movimentos
  for each row execute function private.validar_textos('comentario:500:opcional:Comentário');
