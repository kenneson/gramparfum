import { createClient } from "@/lib/supabase/client";
import { intervaloDia } from "@/lib/domain";

// Lançamento de estoque (amostra, compra, devolução…). quantidade 0 = desfeito (o registro de quem lançou fica)
export type Amostra = {
  id: number;
  produto_id: number;
  tipo?: string;
  quantidade: number;
  comentario: string | null;
  created_at: string;
  created_by: string | null;
  editado_em: string | null;
  produtos: { nome: string };
  abriu: { nome: string } | null;
  editou: { nome: string } | null;
};

// Nome curto e sinal de cada tipo (contagem fica fora do fechamento: ela não entra nem sai)
export const TIPO_MOV: Record<string, { nome: string; sinal: 1 | -1 }> = {
  entrada: { nome: "Compra", sinal: 1 },
  devolucao: { nome: "Devolução", sinal: 1 },
  recuperacao: { nome: "Recuperado", sinal: 1 },
  amostra: { nome: "Amostra", sinal: -1 },
  doacao: { nome: "Doação", sinal: -1 },
  avaria: { nome: "Estragou", sinal: -1 },
};

const supabase = createClient();

// Entradas e saídas de estoque do dia (sem contagem), mais recentes primeiro
export async function movimentosDoDia(lojaId: number, dia: string) {
  const { de, ate } = intervaloDia(dia);
  const { data, error } = await supabase
    .from("estoque_movimentos")
    .select(
      `id, produto_id, tipo, quantidade, comentario, created_at, created_by, editado_em,
       produtos!inner(nome, loja_id),
       abriu:profiles!estoque_movimentos_created_by_fkey(nome),
       editou:profiles!estoque_movimentos_editado_por_fkey(nome)`,
    )
    .neq("tipo", "inventario")
    .eq("produtos.loja_id", lojaId)
    .gte("created_at", de)
    .lte("created_at", ate)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Amostra[];
}

// soma por tipo e produto, ignorando desfeitos
export function porTipoEProduto(movs: Amostra[]) {
  const m = new Map<string, { tipo: string; nome: string; qtd: number }>();
  for (const a of movs) {
    if (!a.quantidade) continue;
    const k = `${a.tipo}|${a.produto_id}`;
    const r = m.get(k) ?? { tipo: a.tipo!, nome: a.produtos.nome, qtd: 0 };
    r.qtd += a.quantidade;
    m.set(k, r);
  }
  return [...m.values()].sort(
    (a, b) => TIPO_MOV[a.tipo].sinal - TIPO_MOV[b.tipo].sinal || b.qtd - a.qtd || a.nome.localeCompare(b.nome),
  );
}
