"use client";

import { useState } from "react";
import {
  Banknote,
  CreditCard,
  Landmark,
  Link2,
  LoaderCircle,
  QrCode,
  X,
} from "lucide-react";
import { FORMAS, money } from "@/lib/domain";
import { resumo, type Pag } from "@/lib/pagamento";
import { campoTexto } from "@/lib/texto";
import { toast } from "sonner";
import { Button, Field, Input, Modal, cx } from "@/components/ui";
import { useApp } from "@/components/shell";

const ICONES = {
  1: QrCode,
  2: Banknote,
  3: CreditCard,
  4: Landmark,
  5: Link2,
} as const;

// `enviar` grava a venda (finalizar ou editar) e trata sucesso/erro; aqui só o estado do formulário
export function Pagamento({
  open,
  onClose,
  total,
  inicial = [],
  rotulo,
  enviar,
}: {
  open: boolean;
  onClose: () => void;
  total: number;
  inicial?: Pag[];
  rotulo?: string;
  enviar: (pagamentos: Pag[]) => Promise<unknown>;
}) {
  const { idioma, t } = useApp();
  const [pags, setPags] = useState<Pag[]>(inicial);
  const [forma, setForma] = useState(1);
  const [valor, setValor] = useState(() =>
    String(resumo(total, inicial).restante || ""),
  );
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);

  const base = resumo(total, pags);
  const atual: Pag | null =
    Number(valor) > 0 ? { forma, valor: Number(valor), comentario } : null;
  const comAtual = resumo(total, atual ? [...pags, atual] : pags);

  // comentário do pagamento é opcional; se preenchido, segue a regra de texto
  function comComentario(p: Pag): Pag | null {
    const c = campoTexto(p.comentario, "Comentário do pagamento", { max: 200 });
    if (c.erro) return (toast.error(c.erro), null);
    return { ...p, comentario: c.valor ?? "" };
  }

  function adicionar() {
    if (!atual) return;
    const p = comComentario(atual);
    if (!p) return;
    const novos = [...pags, p];
    setPags(novos);
    setValor(String(resumo(total, novos).restante || ""));
    setComentario("");
  }

  async function finalizar() {
    const ultimo = atual && comComentario(atual);
    if (atual && !ultimo) return;
    const todos = ultimo ? [...pags, ultimo] : pags;
    setEnviando(true);
    await enviar(todos);
    setEnviando(false);
  }

  const podeFinalizar = comAtual.ok;

  return (
    <Modal open={open} onClose={onClose} title={t.efetuarPagamento}>
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl bg-ink px-5 py-4 text-white">
          <div className="text-xs tracking-wide text-white/60 uppercase">
            {t.total}
          </div>
          <div className="num font-display text-4xl font-bold text-gold-bright">
            {money(total, idioma)}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Object.entries(FORMAS).map(([id, nome]) => {
            const Icon = ICONES[Number(id) as keyof typeof ICONES];
            const sel = forma === Number(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setForma(Number(id))}
                aria-pressed={sel}
                className={cx(
                  "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 text-[11px] leading-tight font-semibold transition",
                  sel
                    ? "border-gold bg-gold-soft text-gold-ink"
                    : "border-line text-muted hover:border-ink/30 hover:text-ink",
                )}
              >
                <Icon size={20} />
                {nome}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[1fr_1.3fr] gap-3">
          <Field label={t.valorReceber}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="num text-lg font-semibold"
            />
          </Field>
          <Field label={t.comentario}>
            <Input
              value={comentario}
              maxLength={200}
              onChange={(e) => setComentario(e.target.value)}
            />
          </Field>
        </div>

        {pags.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {pags.map((p, i) => (
              <li
                key={i}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="font-semibold">{FORMAS[p.forma]}</span>
                {p.comentario && (
                  <span className="truncate text-muted">{p.comentario}</span>
                )}
                <span className="num ml-auto font-semibold">
                  {money(p.valor, idioma)}
                </span>
                <button
                  type="button"
                  aria-label="Remover pagamento"
                  onClick={() => setPags(pags.filter((_, j) => j !== i))}
                  className="text-muted hover:text-danger"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between rounded-xl bg-paper px-4 py-3">
          {comAtual.troco > 0 ? (
            <>
              <span className="text-sm font-semibold text-ok">{t.troco}</span>
              <span className="num font-display text-2xl font-bold text-ok">
                {money(comAtual.troco, idioma)}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm text-muted">{t.falta}</span>
              <span className="num font-display text-2xl font-bold">
                {money(comAtual.restante, idioma)}
              </span>
            </>
          )}
        </div>
        {comAtual.erro && (
          <p className="-mt-2 text-sm text-danger">{comAtual.erro}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {podeFinalizar ? (
            <Button
              variant="gold"
              size="lg"
              onClick={finalizar}
              disabled={enviando}
            >
              {enviando && <LoaderCircle size={18} className="animate-spin" />}
              {rotulo ?? t.finalizar}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={adicionar}
              disabled={!atual || base.restante === 0}
            >
              {t.adicionar} {FORMAS[forma]}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
