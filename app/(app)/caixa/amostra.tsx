"use client";

import { useEffect, useState } from "react";
import { FlaskConical, LoaderCircle, Minus, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { MAX_TEXTO, campoTexto } from "@/lib/texto";
import { Button, Field, Modal, Textarea, cx } from "@/components/ui";
import { useApp } from "@/components/shell";

const supabase = createClient();

// Abrir amostra (provador) direto do Caixa: chefe de loja e administração (o banco confere em private.pode_lancar).
// Mesmo lançamento do Inventário → Movimentar → Amostra: baixa do estoque e fica no histórico com quem abriu.
export function AbrirAmostra({ onClose, onFeita }: { onClose: () => void; onFeita: () => void }) {
  const { lojaId } = useApp();
  const [produtos, setProdutos] = useState<{ id: number; nome: string }[] | null>(null);
  const [busca, setBusca] = useState("");
  const [produto, setProduto] = useState<number | null>(null);
  const [qtd, setQtd] = useState(1);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    supabase
      .from("produtos")
      .select("id, nome")
      .eq("loja_id", lojaId!)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setProdutos(data ?? []));
  }, [lojaId]);

  const q = busca.trim().toLowerCase();
  const lista = (produtos ?? []).filter((p) => !q || p.nome.toLowerCase().includes(q));
  const nome = produtos?.find((p) => p.id === produto)?.nome;

  async function confirmar() {
    if (!produto) return toast.error("Escolha o perfume");
    const c = campoTexto(comentario, "Comentário", { max: MAX_TEXTO });
    if (c.erro) return toast.error(c.erro);
    setEnviando(true);
    const { error } = await supabase.rpc("confirmar_movimento", {
      p_loja_id: lojaId!,
      p_tipo: "amostra",
      p_itens: [{ produto_id: produto, quantidade: qtd }],
      p_comentario: c.valor,
    });
    setEnviando(false);
    if (error) return toast.error("Amostra não registrada", { description: error.message });
    toast.success(`Amostra aberta: ${qtd}× ${nome}`, {
      description: "Baixou do estoque. Errou? Desfaça em Inventário → Lançados hoje.",
    });
    onFeita();
  }

  return (
    <Modal open onClose={onClose} title="Abrir amostra">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Provador aberto na loja. Cada unidade sai do estoque.</p>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 focus-within:border-gold">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar perfume"
            aria-label="Buscar perfume"
            className="min-w-0 flex-1 bg-transparent text-base focus:outline-none sm:text-sm"
          />
        </label>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
          {!produtos ? (
            <div className="grid place-items-center py-8 text-muted">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : lista.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nenhum perfume encontrado.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lista.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setProduto(p.id)}
                    aria-pressed={produto === p.id}
                    className={cx(
                      "flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold transition",
                      produto === p.id ? "bg-gold-soft text-gold-ink" : "hover:bg-paper",
                    )}
                  >
                    <FlaskConical size={15} className={cx("shrink-0", produto !== p.id && "text-muted")} />
                    <span className="min-w-0 truncate">{p.nome}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-sm">
            <span className="block font-semibold">Quantidade</span>
            <span className="block truncate text-xs text-muted">{nome ?? "escolha o perfume acima"}</span>
          </span>
          <div className="flex items-center gap-1 rounded-xl border border-line">
            <button
              type="button"
              aria-label="Menos"
              disabled={qtd <= 1}
              onClick={() => setQtd(qtd - 1)}
              className="grid size-11 place-items-center text-muted disabled:opacity-40"
            >
              <Minus size={16} />
            </button>
            <span className="num w-8 text-center text-base font-bold">{qtd}</span>
            <button
              type="button"
              aria-label="Mais"
              onClick={() => setQtd(qtd + 1)}
              className="grid size-11 place-items-center text-muted"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        <Field label="Comentário (opcional)">
          <Textarea value={comentario} maxLength={MAX_TEXTO} onChange={(e) => setComentario(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="lg" disabled={!produto || enviando} onClick={confirmar}>
            {enviando ? <LoaderCircle size={18} className="animate-spin" /> : <FlaskConical size={18} />}
            {qtd > 1 ? `Abrir ${qtd} amostras` : "Abrir amostra"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
