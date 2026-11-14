"use client";

import { useState } from "react";
import { LoaderCircle, Minus, Plus, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { FORMAS, dataHora, money } from "@/lib/domain";
import { MAX_MOTIVO, campoTexto } from "@/lib/texto";
import { Badge, Button, Field, Input, Modal, Select, Textarea, Toggle, cx } from "@/components/ui";
import { useApp } from "@/components/shell";

const supabase = createClient();

// Vem de venda_para_devolucao: o que foi vendido e o que já voltou, por produto
type VendaDev = {
  id: number;
  created_at: string;
  anulada: boolean;
  vendedor: string;
  itens: { produto_id: number; nome: string; vendido: number; devolvido: number; preco: number }[];
};

// Cliente devolveu: acha a venda pelo número do ticket, escolhe os produtos e o que acontece.
// Padrão = como uma venda cancelada nesses produtos (volta ao estoque e o valor sai do caixa); dá para mudar na hora.
export function Devolucao({ onClose, onFeita }: { onClose: () => void; onFeita: () => void }) {
  const { lojaId, idioma } = useApp();
  const [numero, setNumero] = useState("");
  const [venda, setVenda] = useState<VendaDev | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [qtd, setQtd] = useState<Record<number, number>>({});
  const [voltaEstoque, setVoltaEstoque] = useState(true);
  const [devolveValor, setDevolveValor] = useState(true);
  const [forma, setForma] = useState(2);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(numero.replace(/\D/g, ""));
    if (!id) return toast.error("Digite o número da venda (está no ticket)");
    setBuscando(true);
    const { data, error } = await supabase.rpc("venda_para_devolucao", { p_loja_id: lojaId!, p_venda_id: id });
    setBuscando(false);
    if (error) return toast.error("Erro ao buscar a venda", { description: error.message });
    if (!data) return toast.error(`Venda nº ${id} não encontrada nesta loja`);
    const v = data as VendaDev;
    if (v.anulada) return toast.error(`Venda nº ${id} foi anulada: não há o que devolver`);
    setVenda(v);
    setQtd({});
  }

  const itens = venda?.itens.map((i) => ({ ...i, resta: i.vendido - i.devolvido, n: qtd[i.produto_id] ?? 0 })) ?? [];
  const escolhidos = itens.filter((i) => i.n > 0);
  const valor = escolhidos.reduce((s, i) => s + Number(i.preco) * i.n, 0);
  const set = (id: number, n: number) => setQtd((q) => ({ ...q, [id]: n }));

  async function confirmar() {
    const m = campoTexto(motivo, "Motivo", { obrigatorio: true, max: MAX_MOTIVO });
    if (m.erro) return toast.error(m.erro);
    if (!escolhidos.length) return toast.error("Escolha ao menos um produto");
    if (!voltaEstoque && !devolveValor) return toast.error("Marque ao menos uma opção: estoque ou valor");
    setEnviando(true);
    const { error } = await supabase.rpc("registrar_devolucao", {
      p_venda_id: venda!.id,
      p_itens: escolhidos.map((i) => ({ produto_id: i.produto_id, quantidade: i.n })),
      p_volta_estoque: voltaEstoque,
      p_devolve_valor: devolveValor,
      p_forma: devolveValor ? forma : null,
      p_motivo: m.valor,
    });
    setEnviando(false);
    if (error) return toast.error("Devolução não registrada", { description: error.message });
    toast.success("Devolução registrada", {
      description: [
        voltaEstoque && "produto de volta ao estoque",
        devolveValor && `${money(valor, idioma)} saiu do caixa (${FORMAS[forma]})`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
    onFeita();
  }

  return (
    <Modal open onClose={onClose} title="Devolução">
      <div className="flex flex-col gap-4">
        <form onSubmit={buscar} className="flex items-end gap-2">
          <Field label="Número da venda (no ticket)" className="flex-1">
            <Input
              inputMode="numeric"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Ex.: 000123"
              autoFocus
              className="num"
            />
          </Field>
          <Button type="submit" size="lg" variant="outline" disabled={buscando}>
            {buscando ? <LoaderCircle size={18} className="animate-spin" /> : <Search size={18} />} Buscar
          </Button>
        </form>

        {venda && (
          <>
            <div className="rounded-xl bg-paper px-4 py-3 text-sm">
              <div className="font-semibold">Venda nº {String(venda.id).padStart(6, "0")}</div>
              <div className="text-xs text-muted">
                {dataHora(venda.created_at)} · vendedor {venda.vendedor}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                Quais produtos voltaram?
              </div>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {itens.map((i) => (
                  <li key={i.produto_id} className={cx("flex items-center gap-3 px-3 py-2.5", i.resta === 0 && "opacity-50")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{i.nome}</span>
                      <span className="num text-xs text-muted">
                        {i.vendido} vendido(s) · {money(i.preco, idioma)}
                        {i.devolvido > 0 && ` · ${i.devolvido} já devolvido(s)`}
                      </span>
                    </span>
                    {i.resta === 0 ? (
                      <Badge>tudo devolvido</Badge>
                    ) : (
                      <div className="flex shrink-0 items-center rounded-xl border border-line">
                        <button
                          type="button"
                          aria-label="Menos"
                          disabled={i.n <= 0}
                          onClick={() => set(i.produto_id, i.n - 1)}
                          className="grid size-9 place-items-center rounded-l-xl text-muted active:bg-ink/5 disabled:opacity-30"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="num w-7 text-center text-sm font-semibold">{i.n}</span>
                        <button
                          type="button"
                          aria-label="Mais"
                          disabled={i.n >= i.resta}
                          onClick={() => set(i.produto_id, i.n + 1)}
                          className="grid size-9 place-items-center rounded-r-xl text-muted active:bg-ink/5 disabled:opacity-30"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
              <Toggle label="O produto volta ao estoque" checked={voltaEstoque} onChange={setVoltaEstoque} />
              <Toggle label="Devolver o dinheiro ao cliente" checked={devolveValor} onChange={setDevolveValor} />
              {devolveValor && (
                <div className="flex items-end gap-3">
                  <Field label="Como devolveu" className="flex-1">
                    <Select value={forma} onChange={(e) => setForma(Number(e.target.value))}>
                      {Object.entries(FORMAS).map(([id, nome]) => (
                        <option key={id} value={id}>
                          {nome}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <span className="num pb-2 font-display text-2xl font-bold">{money(valor, idioma)}</span>
                </div>
              )}
              <p className="text-xs text-muted">
                Os dois ligados = como cancelar a venda desses produtos (sai do caixa do dia e dos combos do vendedor).
              </p>
            </div>

            <Field label="Motivo (obrigatório)">
              <Textarea
                value={motivo}
                maxLength={MAX_MOTIVO}
                required
                placeholder="Ex.: cliente não gostou da fragrância"
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="danger" size="lg" disabled={enviando || !escolhidos.length} onClick={confirmar}>
                {enviando ? <LoaderCircle size={18} className="animate-spin" /> : <Undo2 size={18} />}
                Registrar devolução
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
