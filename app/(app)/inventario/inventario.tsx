"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import { dataHora, diasDesde, hojeISO, hora, num, type Estoque } from "@/lib/domain";
import { amostrasDoDia, type Amostra } from "@/lib/amostras";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Tabela, Tabs, cx } from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";
import { Exportar } from "@/components/exportar";

type Aba = "contagem" | "entradas" | "amostras" | "relatorios";
type Abertura = { produto_id: number; quantidade: number; created_at: string };
type Linha = Estoque & { nome: string; aberturas: Abertura[] }; // aberturas: amostras, mais recente primeiro
const supabase = createClient();

// Admin (>= 100): inventário completo. Vendedor e chefe: só abrir e editar amostras (regra também no banco).
export function Inventario() {
  const { lojaId, t, profile } = useApp();
  const admin = profile.role >= 100;
  const [escolhida, setAba] = useState<Aba>("contagem");
  const aba = admin ? escolhida : "amostras";

  const buscar = useCallback(async () => {
    if (!lojaId) return [];
    const [{ data: ps }, { data: es }, { data: as }] = await Promise.all([
      supabase.from("produtos").select("id, nome").eq("loja_id", lojaId).eq("ativo", true).order("nome"),
      supabase.rpc("estoque_loja", { p_loja_id: lojaId }),
      supabase
        .from("estoque_movimentos")
        .select("produto_id, quantidade, created_at, produtos!inner(loja_id)")
        .eq("tipo", "amostra")
        .eq("produtos.loja_id", lojaId)
        .order("created_at", { ascending: false }),
    ]);
    const est = new Map(((es ?? []) as Estoque[]).map((e) => [e.produto_id, e]));
    const aberturas = new Map<number, Abertura[]>();
    for (const a of (as ?? []) as Abertura[]) aberturas.set(a.produto_id, [...(aberturas.get(a.produto_id) ?? []), a]);
    return (ps ?? []).flatMap((p): Linha[] =>
      est.has(p.id) ? [{ ...est.get(p.id)!, nome: p.nome, aberturas: aberturas.get(p.id) ?? [] }] : [],
    );
  }, [lojaId]);
  const [data, carregar] = useData(buscar);
  const linhas = data ?? [];

  if (!lojaId) return <SemLoja />;

  return (
    <>
      <PageHeader
        title={t.inventario}
        subtitle={admin ? undefined : "Abertura e correção de amostras"}
        actions={
          admin && (
            <Tabs<Aba>
              value={aba}
              onChange={setAba}
              items={[
                { value: "contagem", label: "Fazer inventário" },
                { value: "entradas", label: "Entradas" },
                { value: "amostras", label: "Amostras" },
                { value: "relatorios", label: "Relatórios" },
              ]}
            />
          )
        }
      />
      {!data ? null : linhas.length === 0 ? (
        <Empty>Nenhum produto cadastrado nesta loja.</Empty>
      ) : aba === "contagem" ? (
        <Contagem linhas={linhas} onSaved={carregar} />
      ) : aba === "entradas" ? (
        <Lancamento tipo="entrada" linhas={linhas} onSaved={carregar} />
      ) : aba === "amostras" ? (
        <AmostrasAba linhas={linhas} onSaved={carregar} />
      ) : (
        <Relatorios linhas={linhas} />
      )}
    </>
  );
}

const dia = (iso: string) => dataHora(iso).split(",")[0];
const TH = "text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase";
// text-base no celular: menos que 16px faz o iPhone dar zoom no campo
const MINI =
  "num h-10 w-full min-w-0 rounded-lg border border-line bg-card px-2.5 text-base transition focus:border-gold focus:ring-4 focus:ring-gold/15 focus:outline-none xl:h-9 xl:text-sm";

// Contagem: cartão empilhado no celular; a partir de xl as mesmas células viram colunas (xl:contents)
const GRID_CONTAGEM =
  "xl:grid-cols-[minmax(0,1.6fr)_7.5rem_3.5rem_3.5rem_3.5rem_minmax(6.5rem,auto)_4.5rem_5.5rem_minmax(0,1.2fr)_2.25rem]";

// Uma linha editável por produto; Enter salva
function useLinhaForm(onSubmit: (id: number, qtd: number, comentario: string) => Promise<boolean>) {
  const [form, setForm] = useState<Record<number, { qtd: string; com: string }>>({});
  const [salvos, setSalvos] = useState<Set<number>>(new Set());
  const get = (id: number) => form[id] ?? { qtd: "", com: "" };
  const set = (id: number, v: Partial<{ qtd: string; com: string }>) =>
    setForm((f) => ({ ...f, [id]: { ...get(id), ...v } }));
  const salvar = async (id: number) => {
    const { qtd, com } = get(id);
    if (qtd === "" || Number(qtd) < 0 || !Number.isInteger(Number(qtd)))
      return toast.error("Informe uma quantidade inteira");
    if (await onSubmit(id, Number(qtd), com.trim())) {
      set(id, { qtd: "", com: "" });
      setSalvos((s) => new Set(s).add(id));
    }
  };
  return { get, set, salvar, salvos };
}

const useNomeLoja = () => {
  const { lojas, lojaId } = useApp();
  return lojas.find((l) => l.id === lojaId)?.nome ?? "";
};

// amostras do período (as que entram no cálculo), com data de abertura
const aberturasPeriodo = (l: Linha) => l.aberturas.filter((a) => a.created_at > (l.ultimo_inventario ?? ""));

function Contagem({ linhas, onSaved }: { linhas: Linha[]; onSaved: () => void }) {
  const loja = useNomeLoja();
  const f = useLinhaForm(async (id, qtd, comentario) => {
    const l = linhas.find((x) => x.produto_id === id)!;
    const { error } = await supabase.from("estoque_movimentos").insert({
      produto_id: id,
      tipo: "inventario",
      quantidade: qtd,
      saldo_anterior: l.saldo_inventario,
      entradas: l.entradas,
      saidas: l.vendidos + l.amostras,
      comentario: comentario || null,
    });
    if (error) return (toast.error(error.message), false);
    const dif = qtd - l.estoque;
    toast.success(`${l.nome}: inventário registrado`, {
      description: dif === 0 ? "Bateu com o estoque esperado" : `Diferença de ${dif > 0 ? "+" : ""}${dif}`,
    });
    onSaved();
    return true;
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {linhas.length} produtos · a folha exportada sai com a coluna “Contado” em branco
        </p>
        <Exportar
          arquivo="inventario"
          titulo={`Inventário — ${loja}`}
          subtitulo="Estoque esperado desde o último inventário"
          paisagem
          colunas={[
            { titulo: "Produto", largura: 32 },
            { titulo: "Último inventário", tipo: "data" },
            { titulo: "Saldo", tipo: "int" },
            { titulo: "Entradas", tipo: "int" },
            { titulo: "Vendas", tipo: "int" },
            { titulo: "Amostras", tipo: "int" },
            { titulo: "Amostras abertas em", largura: 24 },
            { titulo: "Esperado", tipo: "int" },
            { titulo: "Contado", tipo: "campo", largura: 12 },
          ]}
          linhas={linhas.map((l) => [
            l.nome,
            l.ultimo_inventario,
            l.saldo_inventario,
            l.entradas,
            l.vendidos,
            l.amostras,
            aberturasPeriodo(l)
              .map((a) => dia(a.created_at) + (a.quantidade > 1 ? ` (×${a.quantidade})` : ""))
              .join(", "),
            l.estoque,
            "",
          ])}
        />
      </div>
      <Card className="overflow-hidden">
        <div className={cx("hidden items-center gap-3 border-b border-line px-4 py-3 xl:grid", GRID_CONTAGEM)}>
          <span className={TH}>Produto</span>
          <span className={TH}>Último inventário</span>
          <span className={cx(TH, "text-right")}>Saldo</span>
          <span className={cx(TH, "text-right")}>Entr.</span>
          <span className={cx(TH, "text-right")}>Vendas</span>
          <span className={TH}>Amostras</span>
          <span className={cx(TH, "text-right")}>Esperado</span>
          <span className={TH}>Contagem</span>
          <span className={TH}>Comentário</span>
          <span />
        </div>
        <ul className="divide-y divide-line">
          {linhas.map((l) => {
            const v = f.get(l.produto_id);
            return (
              <li
                key={l.produto_id}
                className={cx(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 text-sm xl:py-2.5",
                  GRID_CONTAGEM,
                  f.salvos.has(l.produto_id) && "bg-ok-soft/50",
                )}
              >
                <span className="min-w-0 font-semibold xl:truncate" title={l.nome}>
                  {l.nome}
                </span>
                <span className="text-right xl:hidden">
                  <span className="block text-[11px] text-muted">Esperado</span>
                  <span className={cx("num text-lg leading-none font-bold", l.estoque < 0 && "text-danger")}>
                    {l.estoque}
                  </span>
                </span>

                <div className="col-span-2 flex flex-wrap items-start gap-x-3 gap-y-1 text-xs text-muted xl:contents xl:text-sm">
                  <span className="whitespace-nowrap">
                    <span className="xl:hidden">Inventário </span>
                    {l.ultimo_inventario ? `${dia(l.ultimo_inventario)} · ${diasDesde(l.ultimo_inventario)}` : "—"}
                  </span>
                  <span className="num xl:text-right xl:text-ink">
                    <span className="xl:hidden">Saldo </span>
                    {l.saldo_inventario}
                  </span>
                  <span className="num text-ok xl:text-right">
                    +{l.entradas}
                    <span className="xl:hidden"> entradas</span>
                  </span>
                  <span className="num text-danger xl:text-right">
                    −{l.vendidos}
                    <span className="xl:hidden"> vendas</span>
                  </span>
                  <span className="whitespace-nowrap">
                    <Amostras linha={l} />
                  </span>
                  <span
                    className={cx("num hidden text-right font-bold text-ink xl:block", l.estoque < 0 && "text-danger")}
                  >
                    {l.estoque}
                  </span>
                </div>

                <div className="col-span-2 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 xl:contents">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    enterKeyHint="done"
                    placeholder="Qtd"
                    aria-label={`Contagem de ${l.nome}`}
                    className={MINI}
                    value={v.qtd}
                    onChange={(e) => f.set(l.produto_id, { qtd: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && f.salvar(l.produto_id)}
                  />
                  <input
                    aria-label={`Comentário de ${l.nome}`}
                    placeholder="Comentário"
                    className={cx(MINI, "font-sans")}
                    value={v.com}
                    onChange={(e) => f.set(l.produto_id, { com: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && f.salvar(l.produto_id)}
                  />
                  <Button
                    aria-label="Registrar"
                    className="size-10 px-0 xl:size-9"
                    disabled={v.qtd === ""}
                    onClick={() => f.salvar(l.produto_id)}
                  >
                    <Check size={16} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

// Amostras abertas desde o último inventário (entram no cálculo), cada uma com a data de abertura.
// Sem nenhuma no período, mostra a última aberta para saber a idade do provador.
function Amostras({ linha }: { linha: Linha }) {
  const periodo = aberturasPeriodo(linha);
  const ultima = linha.aberturas[0];
  if (periodo.length === 0)
    return ultima ? (
      <span className="text-xs text-muted">última aberta {dia(ultima.created_at)}</span>
    ) : (
      <span className="text-muted">
        <span className="xl:hidden">sem amostras</span>
        <span className="hidden xl:inline">—</span>
      </span>
    );
  return (
    <>
      <span className="num font-semibold text-gold-ink">
        −{linha.amostras}
        <span className="xl:hidden"> amostras</span>
      </span>
      {periodo.map((a, i) => (
        <span key={i} className="block text-[11px] text-muted">
          aberta {dia(a.created_at)}
          {a.quantidade > 1 && ` (×${a.quantidade})`}
        </span>
      ))}
    </>
  );
}

const GRID_MOV = "md:grid-cols-[minmax(0,2fr)_4.5rem_6rem_minmax(0,2fr)_auto]";

// Entrada (só admin) ou abertura de amostra (qualquer perfil); quem lança fica em created_by
function Lancamento({ tipo, linhas, onSaved }: { tipo: "entrada" | "amostra"; linhas: Linha[]; onSaved: () => void }) {
  const { profile } = useApp();
  const mostrarEstoque = profile.role >= 100;
  const [busca, setBusca] = useState("");
  const f = useLinhaForm(async (id, qtd, comentario) => {
    if (qtd === 0) return (toast.error("Quantidade precisa ser maior que zero"), false);
    const { error } = await supabase
      .from("estoque_movimentos")
      .insert({ produto_id: id, tipo, quantidade: qtd, comentario: comentario || null });
    if (error) return (toast.error(error.message), false);
    const nome = linhas.find((l) => l.produto_id === id)?.nome;
    toast.success(tipo === "entrada" ? `Entrada de ${qtd} registrada` : `Amostra aberta: ${nome}`, {
      description: tipo === "amostra" ? `${qtd} unidade${qtd > 1 ? "s" : ""} saiu do estoque` : undefined,
    });
    onSaved();
    return true;
  });
  const q = busca.trim().toLowerCase();
  const filtradas = q ? linhas.filter((l) => l.nome.toLowerCase().includes(q)) : linhas;

  return (
    <>
      <div className="relative mb-3">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <Input
          type="search"
          enterKeyHint="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar perfume…"
          className="pl-11"
        />
      </div>
      <Card className="overflow-hidden">
        <div className={cx("hidden items-center gap-3 border-b border-line px-4 py-3 md:grid", GRID_MOV)}>
          <span className={TH}>Produto</span>
          <span className={cx(TH, "text-right")}>{mostrarEstoque && "Estoque"}</span>
          <span className={TH}>Quantidade</span>
          <span className={TH}>Comentário</span>
          <span />
        </div>
        <ul className="divide-y divide-line">
          {filtradas.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">Nenhum perfume encontrado.</li>
          )}
          {filtradas.map((l) => {
            const v = f.get(l.produto_id);
            return (
              <li
                key={l.produto_id}
                className={cx(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 text-sm md:py-2.5",
                  GRID_MOV,
                  f.salvos.has(l.produto_id) && "bg-ok-soft/50",
                )}
              >
                <span className="min-w-0 font-semibold md:truncate" title={l.nome}>
                  {l.nome}
                </span>
                <span className="num text-right text-muted md:text-ink">
                  {mostrarEstoque && (
                    <>
                      <span className="text-xs md:hidden">estoque </span>
                      {l.estoque}
                    </>
                  )}
                </span>
                <div className="col-span-2 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 md:contents">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    enterKeyHint="done"
                    placeholder="Qtd"
                    aria-label={`Quantidade de ${l.nome}`}
                    className={MINI}
                    value={v.qtd}
                    onChange={(e) => f.set(l.produto_id, { qtd: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && f.salvar(l.produto_id)}
                  />
                  <input
                    aria-label={`Comentário de ${l.nome}`}
                    placeholder="Comentário"
                    className={cx(MINI, "font-sans")}
                    value={v.com}
                    onChange={(e) => f.set(l.produto_id, { com: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && f.salvar(l.produto_id)}
                  />
                  <Button
                    className="h-10 xl:h-9"
                    variant={tipo === "entrada" ? "primary" : "gold"}
                    disabled={!v.qtd}
                    onClick={() => f.salvar(l.produto_id)}
                  >
                    {tipo === "entrada" ? "Lançar" : "Abrir"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

type Inv = {
  id: number;
  created_at: string;
  quantidade: number;
  saldo_anterior: number | null;
  entradas: number | null;
  saidas: number | null;
  comentario: string | null;
  produtos: { nome: string };
};

function Relatorios({ linhas }: { linhas: Linha[] }) {
  const { lojaId } = useApp();
  const loja = useNomeLoja();
  const [aba, setAba] = useState<"pendentes" | "historico">("pendentes");
  const [hist, setHist] = useState<Inv[]>([]);
  const [detalhe, setDetalhe] = useState<Linha | null>(null);

  useEffect(() => {
    if (aba !== "historico") return;
    supabase
      .from("estoque_movimentos")
      .select("id, created_at, quantidade, saldo_anterior, entradas, saidas, comentario, produtos!inner(nome, loja_id)")
      .eq("tipo", "inventario")
      .eq("produtos.loja_id", lojaId!)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => setHist((data ?? []) as unknown as Inv[]));
  }, [aba, lojaId]);

  const pendentes = linhas.filter((l) => l.entradas || l.amostras || l.vendidos);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={aba}
          onChange={setAba}
          items={[
            { value: "pendentes", label: "Desde o último inventário" },
            { value: "historico", label: "Histórico de inventários" },
          ]}
        />
        {aba === "pendentes" ? (
          <Exportar
            arquivo="movimentos-desde-inventario"
            titulo={`Movimentos desde o último inventário — ${loja}`}
            colunas={[
              { titulo: "Produto", largura: 32 },
              { titulo: "Último inventário", tipo: "data" },
              { titulo: "Entradas", tipo: "int" },
              { titulo: "Amostras", tipo: "int" },
              { titulo: "Vendas", tipo: "int" },
            ]}
            linhas={pendentes.map((l) => [l.nome, l.ultimo_inventario, l.entradas, l.amostras, l.vendidos])}
          />
        ) : (
          <Exportar
            arquivo="historico-inventarios"
            titulo={`Histórico de inventários — ${loja}`}
            subtitulo={`Últimas ${hist.length} contagens`}
            paisagem
            colunas={[
              { titulo: "Produto", largura: 30 },
              { titulo: "Data", tipo: "data" },
              { titulo: "Saldo", tipo: "int" },
              { titulo: "Entradas", tipo: "int" },
              { titulo: "Saídas", tipo: "int" },
              { titulo: "Esperado", tipo: "int" },
              { titulo: "Contado", tipo: "int" },
              { titulo: "Diferença", tipo: "dif" },
              { titulo: "Comentário", largura: 34 },
            ]}
            linhas={hist.map((h) => {
              const esperado = (h.saldo_anterior ?? 0) + (h.entradas ?? 0) - (h.saidas ?? 0);
              return [
                h.produtos.nome,
                h.created_at,
                h.saldo_anterior,
                h.entradas,
                h.saidas,
                esperado,
                h.quantidade,
                h.quantidade - esperado,
                h.comentario,
              ];
            })}
          />
        )}
      </div>
      {aba === "pendentes" ? (
        pendentes.length === 0 ? (
          <Empty>Nenhum movimento desde os últimos inventários.</Empty>
        ) : (
          <Card className="divide-y divide-line">
            {pendentes.map((l) => (
              <button
                key={l.produto_id}
                type="button"
                onClick={() => setDetalhe(l)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left transition hover:bg-paper"
              >
                <span className="flex-1 font-semibold">{l.nome}</span>
                <Badge tone="ok">+{l.entradas} entradas</Badge>
                <Badge tone="gold">−{l.amostras} amostras</Badge>
                <Badge tone="danger">−{l.vendidos} vendas</Badge>
              </button>
            ))}
          </Card>
        )
      ) : hist.length === 0 ? (
        <Empty>Nenhum inventário registrado.</Empty>
      ) : (
        <Tabela
          head={["Produto", "Data", "Saldo", "Entradas", "Saídas", "Esperado", "Contado", "Diferença", "Comentário"]}
          rows={hist.map((h) => {
            const esperado = (h.saldo_anterior ?? 0) + (h.entradas ?? 0) - (h.saidas ?? 0);
            const dif = h.quantidade - esperado;
            return [
              h.produtos.nome,
              dataHora(h.created_at),
              h.saldo_anterior ?? "—",
              h.entradas ?? "—",
              h.saidas ?? "—",
              esperado,
              <b key="c">{h.quantidade}</b>,
              dif === 0 ? (
                "—"
              ) : (
                <span className={dif < 0 ? "text-danger" : "text-ok"}>{dif > 0 ? `+${dif}` : dif}</span>
              ),
              h.comentario ?? "",
            ];
          })}
        />
      )}
      {detalhe && <DetalheMovimentos key={detalhe.produto_id} linha={detalhe} onClose={() => setDetalhe(null)} />}
    </>
  );
}

type Mov = { created_at: string; quantidade: number; tipo: string; comentario: string | null; quem: string };

function DetalheMovimentos({ linha, onClose }: { linha: Linha; onClose: () => void }) {
  const [movs, setMovs] = useState<Mov[] | null>(null);

  useEffect(() => {
    const desde = linha.ultimo_inventario ?? "1970-01-01";
    Promise.all([
      supabase
        .from("estoque_movimentos")
        .select("created_at, quantidade, tipo, comentario, profiles!estoque_movimentos_created_by_fkey(nome)")
        .eq("produto_id", linha.produto_id)
        .neq("tipo", "inventario")
        .gt("created_at", desde),
      supabase
        .from("venda_itens")
        .select("quantidade, vendas!inner(created_at, anulada, vendedor:profiles!vendas_vendedor_id_fkey(nome))")
        .eq("produto_id", linha.produto_id)
        .eq("vendas.anulada", false)
        .gt("vendas.created_at", desde),
    ]).then(([m, v]) => {
      const a = ((m.data ?? []) as unknown as (Omit<Mov, "quem"> & { profiles: { nome: string } | null })[]).map(
        (r) => ({
          ...r,
          quem: r.profiles?.nome ?? "—",
        }),
      );
      const b = (
        (v.data ?? []) as unknown as {
          quantidade: number;
          vendas: { created_at: string; vendedor: { nome: string } };
        }[]
      ).map((r) => ({
        created_at: r.vendas.created_at,
        quantidade: r.quantidade,
        tipo: "venda",
        comentario: null,
        quem: r.vendas.vendedor.nome,
      }));
      setMovs([...a, ...b].sort((x, y) => y.created_at.localeCompare(x.created_at)));
    });
  }, [linha]);

  const TOM = { entrada: "ok", amostra: "gold", venda: "danger" } as const;

  return (
    <Modal open onClose={onClose} title={linha.nome}>
      {!movs ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {movs.map((m, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
              <Badge tone={TOM[m.tipo as keyof typeof TOM]}>{m.tipo}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate">{m.quem}</div>
                <div className="text-xs text-muted">
                  {dataHora(m.created_at)}
                  {m.comentario && ` · ${m.comentario}`}
                </div>
              </div>
              <span className="num font-bold">
                {m.tipo === "entrada" ? "+" : "−"}
                {num(m.quantidade)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// Amostras do dia (quem abriu, quem editou) + lançamento. Vendedor edita as próprias; chefe+ qualquer uma.
function AmostrasAba({ linhas, onSaved }: { linhas: Linha[]; onSaved: () => void }) {
  const { lojaId, profile } = useApp();
  const loja = useNomeLoja();
  const [dia, setDia] = useState(hojeISO);
  const [editando, setEditando] = useState<Amostra | null>(null);

  const buscar = useCallback(async () => {
    try {
      return { dia, amostras: await amostrasDoDia(lojaId!, dia) };
    } catch (e) {
      toast.error("Erro ao carregar amostras", { description: (e as Error).message });
      return { dia, amostras: [] };
    }
  }, [lojaId, dia]);
  const [data, carregar] = useData(buscar);
  const amostras = data?.dia === dia ? data.amostras : null;
  const podeEditar = (a: Amostra) => profile.role >= 90 || a.created_by === profile.id;
  const atualizar = () => {
    carregar();
    onSaved(); // estoque
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="order-2 xl:order-1">
        <h2 className="mb-3 font-display text-2xl font-semibold">Abrir amostra</h2>
        <Lancamento tipo="amostra" linhas={linhas} onSaved={atualizar} />
      </section>

      <section className="order-1 xl:sticky xl:top-22 xl:order-2">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">Amostras abertas</h2>
          <Field label="Dia" className="w-40">
            <Input type="date" value={dia} max={hojeISO()} onChange={(e) => e.target.value && setDia(e.target.value)} />
          </Field>
        </div>
        <Card>
          {!amostras ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Carregando…</p>
          ) : amostras.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma amostra aberta neste dia.</p>
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto overscroll-contain">
              {amostras.map((a) => (
                <li key={a.id} className={cx("flex items-start gap-3 px-4 py-3", !a.quantidade && "opacity-55")}>
                  <span className="num w-11 shrink-0 pt-0.5 text-xs font-semibold text-muted">
                    {hora(a.created_at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.produtos.nome}</div>
                    <div className="text-xs text-muted">
                      aberta por {a.abriu?.nome ?? "—"}
                      {a.comentario && ` · ${a.comentario}`}
                    </div>
                    {a.editado_em && (
                      <div className="text-[11px] text-gold-ink">
                        editada por {a.editou?.nome ?? "—"} · {dataHora(a.editado_em)}
                      </div>
                    )}
                  </div>
                  {a.quantidade ? <Badge tone="gold">−{a.quantidade}</Badge> : <Badge tone="danger">cancelada</Badge>}
                  {podeEditar(a) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-my-1 size-9 px-0"
                      aria-label={`Editar amostra de ${a.produtos.nome}`}
                      onClick={() => setEditando(a)}
                    >
                      <Pencil size={15} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {!!amostras?.length && (
          <div className="mt-3 flex justify-end">
            <Exportar
              arquivo={`amostras-${dia}`}
              titulo={`Amostras abertas — ${loja}`}
              subtitulo={`Dia ${dia.split("-").reverse().join("/")}`}
              paisagem
              colunas={[
                { titulo: "Aberta em", tipo: "data" },
                { titulo: "Perfume", largura: 32 },
                { titulo: "Qtd", tipo: "int" },
                { titulo: "Aberta por", largura: 20 },
                { titulo: "Comentário", largura: 28 },
                { titulo: "Editada por", largura: 20 },
                { titulo: "Editada em", tipo: "data" },
              ]}
              linhas={amostras.map((a) => [
                a.created_at,
                a.produtos.nome,
                a.quantidade,
                a.abriu?.nome ?? "",
                a.comentario,
                a.editou?.nome ?? "",
                a.editado_em,
              ])}
            />
          </div>
        )}
      </section>

      {editando && (
        <EditarAmostra
          key={editando.id}
          amostra={editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            atualizar();
          }}
        />
      )}
    </div>
  );
}

function EditarAmostra({ amostra, onClose, onSaved }: { amostra: Amostra; onClose: () => void; onSaved: () => void }) {
  const [qtd, setQtd] = useState(String(amostra.quantidade));
  const [comentario, setComentario] = useState(amostra.comentario ?? "");
  const [salvando, setSalvando] = useState(false);
  const n = Number(qtd);
  const valido = qtd !== "" && Number.isInteger(n) && n >= 0;

  async function salvar(quantidade = n) {
    setSalvando(true);
    const { error } = await supabase.rpc("editar_amostra", {
      p_id: amostra.id,
      p_quantidade: quantidade,
      p_comentario: comentario,
    });
    setSalvando(false);
    if (error) return toast.error("Amostra não alterada", { description: error.message });
    toast.success(quantidade === 0 ? "Amostra cancelada — a unidade voltou ao estoque" : "Amostra atualizada");
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Editar amostra">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) salvar();
        }}
      >
        <div className="rounded-xl bg-paper px-4 py-3 text-sm">
          <div className="font-semibold">{amostra.produtos.nome}</div>
          <div className="text-xs text-muted">
            Aberta por {amostra.abriu?.nome ?? "—"} em {dataHora(amostra.created_at)}
          </div>
        </div>
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <Field label="Quantidade">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={qtd}
              onChange={(e) => setQtd(e.target.value)}
              className="num"
            />
          </Field>
          <Field label="Comentário">
            <Input value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          A alteração fica registrada com o seu nome. Quantidade 0 cancela a amostra e devolve a unidade ao estoque.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {amostra.quantidade > 0 ? (
            <Button variant="danger" size="sm" disabled={salvando} onClick={() => salvar(0)}>
              Cancelar amostra
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Voltar
            </Button>
            <Button type="submit" disabled={!valido || salvando}>
              Salvar
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
