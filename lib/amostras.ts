import { createClient } from "@/lib/supabase/client";
import { intervaloDia } from "@/lib/domain";

// quantidade 0 = amostra cancelada (o registro de quem abriu fica)
export type Amostra = {
  id: number;
  produto_id: number;
  quantidade: number;
  comentario: string | null;
  created_at: string;
  created_by: string | null;
  editado_em: string | null;
  produtos: { nome: string };
  abriu: { nome: string } | null;
  editou: { nome: string } | null;
};

const supabase = createClient();

export async function amostrasDoDia(lojaId: number, dia: string) {
  const { de, ate } = intervaloDia(dia);
  const { data, error } = await supabase
    .from("estoque_movimentos")
    .select(
      `id, produto_id, quantidade, comentario, created_at, created_by, editado_em,
       produtos!inner(nome, loja_id),
       abriu:profiles!estoque_movimentos_created_by_fkey(nome),
       editou:profiles!estoque_movimentos_editado_por_fkey(nome)`,
    )
    .eq("tipo", "amostra")
    .eq("produtos.loja_id", lojaId)
    .gte("created_at", de)
    .lte("created_at", ate)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Amostra[];
}

// soma por produto, ignorando canceladas
export function amostrasPorProduto(amostras: Amostra[]) {
  const m = new Map<number, { nome: string; qtd: number }>();
  for (const a of amostras) {
    if (!a.quantidade) continue;
    const r = m.get(a.produto_id) ?? { nome: a.produtos.nome, qtd: 0 };
    r.qtd += a.quantidade;
    m.set(a.produto_id, r);
  }
  return [...m.values()].sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));
}
