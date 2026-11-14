"use client";

import { useCallback, useState } from "react";
import { CircleCheck, LoaderCircle, Store, Target, Trophy } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import { hojeISO, num } from "@/lib/domain";
import { Avatar, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, cx } from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";

// Vem de ranking_vendedores: só ativos (vendedor e chefe), em combos (sem valores em R$).
// Meta = a individual, se houver; senão a da loja (meta_individual diz qual).
type Linha = {
  user_id: string;
  nome: string;
  combos: number;
  itens: number;
  vendas: number;
  meta_minima: number | null;
  meta_media: number | null;
  meta_full: number | null;
  meta_individual: boolean;
};
type MetaLoja = { meta_minima: number; meta_media: number; meta_maxima: number };

const supabase = createClient();
const NIVEIS = [
  { k: "meta_full", nome: "Máxima" },
  { k: "meta_media", nome: "Média" },
  { k: "meta_minima", nome: "Mínima" },
] as const;

// Troféus dos 3 primeiros (só quem vendeu)
const TROFEUS = [
  { nome: "Ouro", cor: "bg-gold text-white" },
  { nome: "Prata", cor: "bg-[#9aa0a6] text-white" },
  { nome: "Bronze", cor: "bg-[#b0703c] text-white" },
];

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
  const [metaLoja, setMetaLoja] = useState(false);
  const podeMeta = profile.role >= 100; // metas: só a administração define

  const [ano, m] = mes.split("-").map(Number);
  const de = `${mes}-01`;
  const ate = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10); // último dia do mês

  const buscar = useCallback(async () => {
    if (!lojaId) return null;
    const [r, ml] = await Promise.all([
      supabase.rpc("ranking_vendedores", { p_loja_id: lojaId, p_de: de, p_ate: ate }),
      supabase.from("metas_loja").select("meta_minima, meta_media, meta_maxima").eq("loja_id", lojaId).maybeSingle(),
    ]);
    if (r.error) toast.error("Erro ao carregar o ranking", { description: r.error.message });
    return {
      mes: de,
      linhas: ((r.data ?? []) as Linha[]).map((l) => ({ ...l, combos: Number(l.combos) })),
      metaLoja: ml.data as MetaLoja | null,
    };
  }, [lojaId, de, ate]);
  const [data, carregar] = useData(buscar);
  const linhas = data?.mes === de ? data.linhas : null;

  if (!lojaId) return <SemLoja />;

  // escala comum: a barra mais alta ou a maior meta máxima
  const escala = Math.max(1, ...(linhas ?? []).flatMap((l) => [l.combos, Number(l.meta_full ?? 0)]));
  const ml = data?.metaLoja;

  return (
    <>
      <PageHeader
        title="Ranking de vendedores"
        subtitle="Combos vendidos no mês. Vendas anuladas e devoluções com valor devolvido não contam."
        actions={
          <Field label="Mês">
            <Input type="month" value={mes} max={hojeISO().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </Field>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 shadow-card">
        <span className="flex items-center gap-2 text-sm">
          <Store size={16} className="shrink-0 text-gold" />
          {ml ? (
            <span className="num">
              <b>Meta da loja</b> · mínima {num(ml.meta_minima, 2)} · média {num(ml.meta_media, 2)} · máxima{" "}
              {num(ml.meta_maxima, 2)} combos
            </span>
          ) : (
            <span className="text-muted">Sem meta da loja definida.</span>
          )}
        </span>
        {podeMeta && (
          <Button variant="outline" size="sm" onClick={() => setMetaLoja(true)}>
            <Target size={14} /> {ml ? "Alterar meta da loja" : "Definir meta da loja"}
          </Button>
        )}
      </div>
      {podeMeta && (
        <p className="mb-4 text-sm text-muted">
          A meta da loja vale para todos. Para alguém ter uma meta diferente, use <b className="text-ink">Meta individual</b>{" "}
          na pessoa.
        </p>
      )}

      {!linhas ? (
        <div className="grid place-items-center py-20 text-muted">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : linhas.length === 0 ? (
        <Empty>Nenhum vendedor ativo nesta loja.</Empty>
      ) : (
        <>
          <Grafico linhas={linhas} escala={escala} eu={profile.id} />
          <Card className="divide-y divide-line">
            {linhas.map((l, i) => {
              const { batido, proximo } = nivel(l);
              const eu = l.user_id === profile.id;
              const temMeta = l.meta_full != null;
              const trofeu = l.combos > 0 ? TROFEUS[i] : undefined;
              return (
                <div key={l.user_id} className={cx("px-4 py-4 sm:px-5", eu && "bg-gold-soft/30")}>
                  <div className="flex items-center gap-3">
                    <span
                      className={cx(
                        "num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold",
                        trofeu ? trofeu.cor : "bg-ink/5 text-muted",
                      )}
                      title={trofeu ? `Troféu de ${trofeu.nome.toLowerCase()} · ${i + 1}º lugar` : `${i + 1}º lugar`}
                      aria-label={trofeu ? `Troféu de ${trofeu.nome.toLowerCase()}, ${i + 1}º lugar` : `${i + 1}º lugar`}
                    >
                      {trofeu ? <Trophy size={15} /> : i + 1}
                    </span>
                    <Avatar nome={l.nome} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold">{l.nome}</span>
                        {eu && <Badge tone="gold">Você</Badge>}
                        {trofeu && <Badge>{trofeu.nome}</Badge>}
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
                          · mín {num(l.meta_minima, 2)} · méd {num(l.meta_media, 2)} · máx {num(l.meta_full, 2)}
                          {l.meta_individual ? " (individual)" : " (da loja)"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">Sem meta definida</span>
                    )}
                    {podeMeta && (
                      <Button variant="outline" size="sm" onClick={() => setEditando(l)}>
                        <Target size={14} /> {l.meta_individual ? "Alterar meta individual" : "Meta individual"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        </>
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
      {metaLoja && (
        <MetasDaLoja
          atual={ml ?? null}
          lojaId={lojaId}
          onClose={() => setMetaLoja(false)}
          onSaved={() => {
            setMetaLoja(false);
            carregar();
          }}
        />
      )}
    </>
  );
}

// Barras verticais: altura = combos do mês; marcas finas = metas da pessoa (mesma escala para todos)
function Grafico({ linhas, escala, eu }: { linhas: Linha[]; escala: number; eu: string }) {
  const pct = (v: number) => `${(Math.max(0, v) / escala) * 100}%`;
  return (
    <Card className="mb-5 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold">Progresso do mês</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block h-0.5 w-4 rounded-full bg-ink/60" /> metas (mínima, média, máxima)
        </span>
      </div>
      <div className="overflow-x-auto">
        <div
          className="flex h-56 items-end gap-0.5 border-b border-line pt-6"
          style={{ minWidth: `${linhas.length * 3.25}rem` }}
          role="img"
          aria-label={`Combos do mês: ${linhas.map((l) => `${l.nome} ${num(l.combos, 2)}`).join(", ")}`}
        >
          {linhas.map((l) => (
            <div
              key={l.user_id}
              className="relative flex h-full min-w-12 flex-1 flex-col justify-end px-1.5"
              title={`${l.nome}: ${num(l.combos, 2)} combos${l.meta_full != null ? ` · metas ${num(l.meta_minima, 2)} / ${num(l.meta_media, 2)} / ${num(l.meta_full, 2)}` : ""}`}
            >
              <span
                className="num absolute right-0 left-0 text-center text-[11px] font-semibold text-muted"
                style={{ bottom: `calc(${pct(l.combos)} + 4px)` }}
              >
                {num(l.combos, l.combos % 1 ? 1 : 0)}
              </span>
              <div
                className={cx(
                  "mx-auto w-full max-w-12 rounded-t-[4px] transition-[height] duration-500",
                  l.user_id === eu ? "bg-gold" : "bg-gold/70",
                )}
                style={{ height: pct(l.combos) }}
              />
              {NIVEIS.map(
                (n) =>
                  l[n.k] != null && (
                    <span
                      key={n.k}
                      className="absolute right-1 left-1 mx-auto h-0.5 max-w-14 rounded-full bg-ink/60"
                      style={{ bottom: pct(Number(l[n.k])) }}
                    />
                  ),
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-0.5" style={{ minWidth: `${linhas.length * 3.25}rem` }}>
          {linhas.map((l) => (
            <span
              key={l.user_id}
              className={cx(
                "min-w-12 flex-1 truncate px-0.5 pt-1.5 text-center text-[11px]",
                l.user_id === eu ? "font-bold text-ink" : "text-muted",
              )}
            >
              {l.nome.split(" ")[0]}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Valida e devolve [mín, méd, máx] ou a mensagem de erro
function lerMetas(v: { minima: string; media: string; maxima: string }) {
  const n = (s: string) => Number(s.replace(",", "."));
  const [min, med, max] = [n(v.minima), n(v.media), n(v.maxima)];
  const erro =
    !v.minima || !v.media || !v.maxima || ![min, med, max].every(Number.isFinite)
      ? "Preencha as três metas"
      : min <= 0
        ? "A mínima precisa ser maior que zero"
        : !(min <= med && med <= max)
          ? "Mínima ≤ Média ≤ Máxima"
          : null;
  return { erro, min, med, max };
}

function CamposMetas({
  v,
  setV,
}: {
  v: { minima: string; media: string; maxima: string };
  setV: (v: { minima: string; media: string; maxima: string }) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(
        [
          ["minima", "Mínima"],
          ["media", "Média"],
          ["maxima", "Máxima"],
        ] as const
      ).map(([k, rotulo]) => (
        <Field key={k} label={rotulo}>
          <Input inputMode="decimal" className="num" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        </Field>
      ))}
    </div>
  );
}

function MetasDaLoja({
  atual,
  lojaId,
  onClose,
  onSaved,
}: {
  atual: MetaLoja | null;
  lojaId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    minima: atual?.meta_minima.toString() ?? "",
    media: atual?.meta_media.toString() ?? "",
    maxima: atual?.meta_maxima.toString() ?? "",
  });
  const { erro, min, med, max } = lerMetas(v);

  async function salvar() {
    const { error } = await supabase.from("metas_loja").upsert({
      loja_id: lojaId,
      meta_minima: min,
      meta_media: med,
      meta_maxima: max,
      updated_at: new Date().toISOString(),
    });
    if (error) return toast.error("Meta não salva", { description: error.message });
    toast.success("Meta da loja salva");
    onSaved();
  }

  async function remover() {
    if (!confirm("Remover a meta da loja? Quem não tem meta individual fica sem meta.")) return;
    const { error } = await supabase.from("metas_loja").delete().eq("loja_id", lojaId);
    if (error) return toast.error("Meta não removida", { description: error.message });
    toast.success("Meta da loja removida");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Meta da loja">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!erro) salvar();
        }}
      >
        <p className="text-sm text-muted">
          Combos por mês para cada vendedor. Vale para todos os meses até ser alterada; quem tem meta individual usa a
          dele.
        </p>
        <CamposMetas v={v} setV={setV} />
        {erro && <p className="text-xs text-muted">{erro}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {atual ? (
            <Button variant="danger" onClick={remover}>
              Remover
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!!erro}>
              Salvar meta da loja
            </Button>
          </div>
        </div>
      </form>
    </Modal>
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
  // sem individual: começa com a da loja (o que vale hoje) para facilitar
  const [v, setV] = useState({
    minima: linha.meta_minima?.toString() ?? "",
    media: linha.meta_media?.toString() ?? "",
    maxima: linha.meta_full?.toString() ?? "",
  });
  const { erro, min, med, max } = lerMetas(v);

  async function salvar() {
    const { error } = await supabase.from("metas").upsert({
      loja_id: lojaId,
      user_id: linha.user_id,
      meta_minima: min,
      meta_media: med,
      meta_full: max,
      updated_at: new Date().toISOString(),
    });
    if (error) return toast.error("Metas não salvas", { description: error.message });
    toast.success(`Meta individual de ${linha.nome} salva`);
    onSaved();
  }

  async function remover() {
    const { error } = await supabase.from("metas").delete().eq("loja_id", lojaId).eq("user_id", linha.user_id);
    if (error) return toast.error("Metas não removidas", { description: error.message });
    toast.success(`${linha.nome} volta a usar a meta da loja`);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`Meta individual de ${linha.nome}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!erro) salvar();
        }}
      >
        <p className="text-sm text-muted">
          Combos por mês só para {linha.nome}, no lugar da meta da loja. Vale para todos os meses até ser alterada.
        </p>
        <CamposMetas v={v} setV={setV} />
        {erro && <p className="text-xs text-muted">{erro}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {linha.meta_individual ? (
            <Button variant="danger" onClick={remover}>
              Usar a meta da loja
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!!erro}>
              Salvar meta individual
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
