// Regra única de texto digitado (navegador e server actions; o banco repete a regra em private.texto_ok).
// limpar: tira caracteres invisíveis/de controle, junta espaços e corta as pontas.
export const limpar = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const MIN_LETRAS = 3;
export const MAX_NOME = 80;
export const MAX_TEXTO = 500;
// anulação: o servidor acrescenta "— solicitado por <nome>" (até MAX_NOME) e o banco limita em MAX_TEXTO
export const MAX_MOTIVO = MAX_TEXTO - MAX_NOME - 20;

type Regra = { obrigatorio?: boolean; max?: number };

// valor: texto limpo (null quando vazio e opcional); erro: mensagem pronta para o usuário
export function campoTexto(
  bruto: string | null | undefined,
  rotulo: string,
  { obrigatorio = false, max = MAX_TEXTO }: Regra = {},
): { valor: string | null; erro: string | null } {
  const valor = limpar(bruto);
  if (!valor)
    return {
      valor: null,
      erro: obrigatorio ? `${rotulo}: campo obrigatório` : null,
    };
  if ((valor.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < MIN_LETRAS)
    return { valor, erro: `${rotulo}: escreva ao menos ${MIN_LETRAS} letras` };
  if (valor.length > max)
    return { valor, erro: `${rotulo}: no máximo ${max} caracteres` };
  return { valor, erro: null };
}

// Vários campos de uma vez: primeiro erro encontrado ou os valores limpos
export function validar<K extends string>(
  campos: Record<K, ReturnType<typeof campoTexto>>,
) {
  const erro =
    Object.values<ReturnType<typeof campoTexto>>(campos).find((c) => c.erro)
      ?.erro ?? null;
  const valores = Object.fromEntries(
    Object.entries<ReturnType<typeof campoTexto>>(campos).map(([k, c]) => [
      k,
      c.valor,
    ]),
  );
  return { erro, valores: valores as Record<K, string | null> };
}
