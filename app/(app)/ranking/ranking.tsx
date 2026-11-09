"use client";

import { useCallback, useState } from "react";
import { CircleCheck, LoaderCircle, Target, Trophy } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import { hojeISO, num } from "@/lib/domain";
import { Avatar, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, cx } from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";

// Vem de ranking_vendedores: só ativos (vendedor e chefe), em combos (sem valores em R$)
type Linha = {
  user_id: string;
  nome: string;
  combos: number;
  itens: number;
  vendas: number;
  meta_minima: number | null;
  meta_media: number | null;
  meta_full: number | null;
};

const supabase = createClient();
const NIVEIS = [
  { k: "meta_full", nome: "FULL" },
  { k: "meta_media", nome: "Média" },
  { k: "meta_minima", nome: "Mínima" },
] as const;

// maior nível batido e o próximo a buscar
function nivel(l: Linha) {
  const batido = NIVEIS.find((n) => l[n.k] != null && l.combos >= Number(l[n.k]));
  const proximo = [...NIVEIS].reverse().find((n) => l[n.k] != null && l.combos < Number(l[n.k]));
  return { batido, proximo };
}

export function Ranking() {
  const { lojaId, profile } = useApp();
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [editando, setEditando] = useState<Linha | null>(null);
  const podeMeta = profile.role >= 90;

  const [ano, m] = mes.split("-").map(Number);
  const de = `${mes}-01`;
  const ate = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10); // último dia do mês

  const buscar = useCallback(async () => {
    if (!lojaId) return null;
    const { data, error } = await supabase.rpc("ranking_vendedores", { p_loja_id: lojaId, p_de: de, p_ate: ate });
    if (error) toast.error("Erro ao carregar o ranking", { description: error.message });
    return { mes: de, linhas: ((data ?? []) as Linha[]).map((l) => ({ ...l, combos: Number(l.combos) })) };
  }, [lojaId, de, ate]);
  const [data, carregar] = useData(buscar);
  const linhas = data?.mes === de ? data.linhas : null;

  if (!lojaId) return <SemLoja />;

  // escala comum: a barra mais longa ou a maior meta FULL
  const escala = Math.max(1, ...(linhas ?? []).flatMap((l) => [l.combos, Number(l.meta_full ?? 0)]));

  return (
    <>
      <PageHeader
        title="Ranking de vendedores"
        subtitle="Combos vendidos no mês. Vendas anuladas não contam."
        actions={
          <Field label="Mês">
            <Input type="month" value={mes} max={hojeISO().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </Field>
        }
      />

      {podeMeta && (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-muted">
          <Target size={16} className="shrink-0 text-gold" />
          Use <b className="text-ink">Definir metas</b> em cada pessoa para cadastrar as metas mínima, média e FULL.
        </p>
      )}

      {!linhas ? (
        <div className="grid place-items-center py-20 text-muted">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : linhas.length === 0 ? (
        <Empty>Nenhum vendedor ativo nesta loja.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {linhas.map((l, i) => {
            const { batido, proximo } = nivel(l);
            const eu = l.user_id === profile.id;
            const temMeta = l.meta_full != null;
            return (
              <div key={l.user_id} className={cx("px-4 py-4 sm:px-5", eu && "bg-gold-soft/30")}>
                <div className="flex items-center gap-3">
                  <span
                    className={cx(
                      "num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold",
                      i === 0 && l.combos > 0 ? "bg-gold text-white" : "bg-ink/5 text-muted",
                    )}
                    aria-label={`${i + 1}º lugar`}
                  >
                    {i === 0 && l.combos > 0 ? <Trophy size={15} /> : i + 1}
                  </span>
                  <Avatar nome={l.nome} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold">{l.nome}</span>
                      {eu && <Badge tone="gold">Você</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {l.vendas} venda{l.vendas === 1 ? "" : "s"} · {l.itens} ite{l.itens === 1 ? "m" : "ns"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num font-display text-2xl leading-none font-bold">{num(l.combos, 2)}</div>
                    <div className="text-[11px] text-muted">combos</div>
                  </div>
                </div>

                {/* barra: comprimento = combos; marcas finas = metas (mesma escala para todos) */}
                <div className="relative mt-3 h-3 rounded-full bg-ink/5" title={`${num(l.combos, 2)} combos`}>
                  <div
                    className="h-full rounded-full bg-gold transition-[width] duration-500"
                    style={{ width: `${(l.combos / escala) * 100}%` }}
                  />
                  {NIVEIS.map(
                    (n) =>
                      l[n.k] != null && (
                        <span
                          key={n.k}
                          title={`Meta ${n.nome}: ${num(l[n.k], 2)}`}
                          className="absolute -top-1 h-5 w-0.5 rounded-full bg-ink/60"
                          style={{ left: `calc(${(Number(l[n.k]) / escala) * 100}% - 1px)` }}
                        />
                      ),
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {temMeta ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-muted">
                      {batido ? (
                        <Badge tone="ok">
                          <CircleCheck size={12} className="mr-1" /> Meta {batido.nome} batida
                        </Badge>
                      ) : (
                        <Badge>Abaixo da mínima</Badge>
                      )}
                      {proximo && (
                        <span>
                          faltam <b className="num text-ink">{num(Number(l[proximo.k]) - l.combos, 2)}</b> para a{" "}
                          {proximo.nome}
                        </span>
                      )}
                      <span className="num">
                        · mín {num(l.meta_minima, 2)} · méd {num(l.meta_media, 2)} · FULL {num(l.meta_full, 2)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted">Sem meta definida</span>
                  )}
                  {podeMeta && (
                    <Button variant="outline" size="sm" onClick={() => setEditando(l)}>
                      <Target size={14} /> {temMeta ? "Alterar metas" : "Definir metas"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {editando && (
        <Metas
          linha={editando}
          lojaId={lojaId}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

function Metas({
  linha,
  lojaId,
  onClose,
  onSaved,
}: {
  linha: Linha;
  lojaId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    meta_minima: linha.meta_minima?.toString() ?? "",
    meta_media: linha.meta_media?.toString() ?? "",
    meta_full: linha.meta_full?.toString() ?? "",
  });
  const n = (s: string) => Number(s.replace(",", "."));
  const [min, med, full] = [n(v.meta_minima), n(v.meta_media), n(v.meta_full)];
  const erro =
    !v.meta_minima || !v.meta_media || !v.meta_full || ![min, med, full].every(Number.isFinite)
      ? "Preencha as três metas"
      : min <= 0
        ? "A mínima precisa ser maior que zero"
        : !(min <= med && med <= full)
          ? "Mínima ≤ Média ≤ FULL"
          : null;

  async function salvar() {
    const { error } = await supabase
      .from("metas")
      .upsert({ loja_id: lojaId, user_id: linha.user_id, meta_minima: min, meta_media: med, meta_full: full, updated_at: new Date().toISOString() });
    if (error) return toast.error("Metas não salvas", { description: error.message });
    toast.success(`Metas de ${linha.nome} salvas`);
    onSaved();
  }

  async function remover() {
    const { error } = await supabase.from("metas").delete().eq("loja_id", lojaId).eq("user_id", linha.user_id);
    if (error) return toast.error("Metas não removidas", { description: error.message });
    toast.success(`Metas de ${linha.nome} removidas`);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`Metas de ${linha.nome}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!erro) salvar();
        }}
      >
        <p className="text-sm text-muted">Quantidade de combos por mês. Vale para todos os meses até ser alterada.</p>
        <div className="grid grid-cols-3 gap-2">
          {NIVEIS.slice()
            .reverse()
            .map((nv) => (
              <Field key={nv.k} label={nv.nome}>
                <Input
                  inputMode="decimal"
                  className="num"
                  value={v[nv.k]}
                  onChange={(e) => setV({ ...v, [nv.k]: e.target.value })}
                />
              </Field>
            ))}
        </div>
        {erro && <p className="text-xs text-muted">{erro}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {linha.meta_full != null ? (
            <Button variant="danger" onClick={remover}>
              Remover metas
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!!erro}>
              Salvar metas
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
