"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  CircleAlert,
  ClipboardCheck,
  FlaskConical,
  Gift,
  LoaderCircle,
  Minus,
  PackageX,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import {
  TZ,
  dataHora,
  diasDesde,
  hojeISO,
  hora,
  intervaloDia,
  num,
  type Estoque,
} from "@/lib/domain";
import type { Amostra } from "@/lib/amostras";
import { MAX_TEXTO, campoTexto } from "@/lib/texto";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
  Tabs,
  Textarea,
  cx,
} from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";
import { Exportar } from "@/components/exportar";

const supabase = createClient();

/* ───────────── Tipos de movimentação ───────────── */

type Tipo =
  "entrada" | "devolucao" | "amostra" | "doacao" | "avaria" | "inventario";
type Tom = "ok" | "gold" | "danger" | "neutral";

// sinal: +1 soma, −1 baixa, 0 = contagem (define o total). "venda" só aparece no histórico (vem do caixa).
const TIPOS: Record<
  Tipo | "venda",
  {
    nome: string;
    curto: string;
    ajuda: string;
    sinal: 1 | -1 | 0;
    tom: Tom;
    icone: LucideIcon;
  }
> = {
  entrada: {
    nome: "Compra de fornecedor",
    curto: "Compra",
    ajuda: "Mercadoria nova que chegou do fornecedor.",
    sinal: 1,
    tom: "ok",
    icone: Truck,
  },
  devolucao: {
    nome: "Devolução de cliente",
    curto: "Devolução",
    ajuda: "Produto vendido que o cliente devolveu.",
    sinal: 1,
    tom: "ok",
    icone: Undo2,
  },
  amostra: {
    nome: "Amostra",
    curto: "Amostra",
    ajuda: "Provador aberto na loja.",
    sinal: -1,
    tom: "gold",
    icone: FlaskConical,
  },
  doacao: {
    nome: "Doação",
    curto: "Doação",
    ajuda: "Saída com 100% de desconto. Só chefe de loja ou administração.",
    sinal: -1,
    tom: "gold",
    icone: Gift,
  },
  avaria: {
    nome: "Estragou",
    curto: "Estragou",
    ajuda: "Quebrou, vazou ou venceu.",
    sinal: -1,
    tom: "danger",
    icone: PackageX,
  },
  inventario: {
    nome: "Contagem",
    curto: "Contagem",
    ajuda: "Conte o que tem na prateleira; o sistema calcula a diferença.",
    sinal: 0,
    tom: "neutral",
    icone: ClipboardCheck,
  },
  venda: {
    nome: "Venda",
    curto: "Venda",
    ajuda: "Pelo caixa.",
    sinal: -1,
    tom: "neutral",
    icone: ShoppingBag,
  },
};

const GRUPOS: { titulo: string; tipos: Tipo[] }[] = [
  { titulo: "Entrada", tipos: ["entrada", "devolucao"] },
  { titulo: "Saída", tipos: ["amostra", "doacao", "avaria"] },
  { titulo: "Conferência", tipos: ["inventario"] },
];

const TOM_ICONE: Record<Tom, string> = {
  ok: "bg-ok-soft text-ok",
  gold: "bg-gold-soft text-gold-ink",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-ink/5 text-muted",
};

/* ───────────── Dados da loja ───────────── */

type Abertura = { produto_id: number; quantidade: number; created_at: string };
type Linha = Estoque & { nome: string; aberturas: Abertura[] }; // aberturas: amostras, mais recente primeiro
type Aba = "estoque" | "movimentar" | "historico";

const dia = (iso: string) => dataHora(iso).split(",")[0];
const baixo = (l: Linha) => l.minimo > 0 && l.estoque <= l.minimo;
// amostras do período (as que entram no cálculo), com data de abertura
const aberturasPeriodo = (l: Linha) =>
  l.aberturas.filter((a) => a.created_at > (l.ultimo_inventario ?? ""));

const useNomeLoja = () => {
  const { lojas, lojaId } = useApp();
  return lojas.find((l) => l.id === lojaId)?.nome ?? "";
};

// Administração (>= 100) vê saldos. Demais perfis lançam (doação só chefe+) e contam "às cegas".
export function Inventario() {
  const { lojaId, t, profile } = useApp();
  const verEstoque = profile.role >= 100;
  const [escolhida, setAba] = useState<Aba>(
    verEstoque ? "estoque" : "movimentar",
  );
  const aba = !verEstoque && escolhida === "estoque" ? "movimentar" : escolhida;
  const [tipo, setTipo] = useState<Tipo>(verEstoque ? "entrada" : "amostra");
  const rascunhos = useRascunhos(lojaId);

  const buscar = useCallback(async () => {
    if (!lojaId) return [];
    const [{ data: ps }, { data: es }, { data: as }] = await Promise.all([
      supabase
        .from("produtos")
        .select("id, nome")
        .eq("loja_id", lojaId)
        .eq("ativo", true)
        .order("nome"),
      supabase.rpc("estoque_loja", { p_loja_id: lojaId }),
      supabase
        .from("estoque_movimentos")
        .select("produto_id, quantidade, created_at, produtos!inner(loja_id)")
        .eq("tipo", "amostra")
        .eq("produtos.loja_id", lojaId)
        .order("created_at", { ascending: false }),
    ]);
    const est = new Map(
      ((es ?? []) as Estoque[]).map((e) => [e.produto_id, e]),
    );
    const aberturas = new Map<number, Abertura[]>();
    for (const a of (as ?? []) as Abertura[])
      aberturas.set(a.produto_id, [...(aberturas.get(a.produto_id) ?? []), a]);
    return (ps ?? []).flatMap((p): Linha[] =>
      est.has(p.id)
        ? [
            {
              ...est.get(p.id)!,
              nome: p.nome,
              aberturas: aberturas.get(p.id) ?? [],
            },
          ]
        : [],
    );
  }, [lojaId]);
  const [data, carregar] = useData(buscar);
  const linhas = data ?? [];

  if (!lojaId) return <SemLoja />;

  return (
    <>
      <PageHeader
        title={t.inventario}
        actions={
          <Tabs<Aba>
            value={aba}
            onChange={setAba}
            items={[
              ...(verEstoque
                ? [{ value: "estoque" as const, label: "Estoque" }]
                : []),
              { value: "movimentar", label: "Movimentar" },
              { value: "historico", label: "Histórico" },
            ]}
          />
        }
      />
      {!data ? null : linhas.length === 0 ? (
        <Empty>Nenhum produto cadastrado nesta loja.</Empty>
      ) : aba === "estoque" ? (
        <EstoqueAba
          linhas={linhas}
          onSaved={carregar}
          onContar={() => {
            setTipo("inventario");
            setAba("movimentar");
          }}
        />
      ) : aba === "movimentar" ? (
        <Movimentar
          linhas={linhas}
          verEstoque={verEstoque}
          tipo={tipo}
          setTipo={setTipo}
          rascunhos={rascunhos}
          onSaved={carregar}
        />
      ) : (
        <Historico onSaved={carregar} />
      )}
    </>
  );
}

/* ───────────── Rascunhos com autosave ───────────── */

type ItemR = { produto_id: number; quantidade: number };
type Rascunho = { itens: ItemR[]; comentario: string };
type Status = "salvando" | "salvo" | "erro";
const VAZIO: Rascunho = { itens: [], comentario: "" };
const ESPERA_MS = 700;

// Um rascunho por tipo, salvo no servidor a cada mudança (debounce). O estoque só muda em confirmar().
function useRascunhos(lojaId: number | null) {
  const { profile } = useApp();
  const buscar = useCallback(async () => {
    if (!lojaId) return {};
    const { data } = await supabase
      .from("estoque_rascunhos")
      .select("tipo, comentario, itens")
      .eq("loja_id", lojaId)
      .eq("user_id", profile.id);
    return Object.fromEntries(
      (data ?? []).map((r) => [
        r.tipo,
        { itens: r.itens as ItemR[], comentario: r.comentario ?? "" },
      ]),
    ) as Partial<Record<Tipo, Rascunho>>;
  }, [lojaId, profile.id]);
  const [mapa, , setMapa] = useData(buscar);
  const [status, setStatus] = useState<Partial<Record<Tipo, Status>>>({});
  const timers = useRef<
    Partial<Record<Tipo, { id: ReturnType<typeof setTimeout>; r: Rascunho }>>
  >({});
  const fila = useRef<Partial<Record<Tipo, Promise<unknown>>>>({}); // gravações em ordem, por tipo

  const gravar = useCallback(
    (tipo: Tipo, r: Rascunho) => {
      const chave = { loja_id: lojaId!, user_id: profile.id, tipo };
      fila.current[tipo] = (fila.current[tipo] ?? Promise.resolve()).then(
        async () => {
          const vazio = r.itens.length === 0 && !r.comentario.trim();
          const { error } = vazio
            ? await supabase.from("estoque_rascunhos").delete().match(chave)
            : await supabase.from("estoque_rascunhos").upsert({
                ...chave,
                itens: r.itens,
                comentario: r.comentario || null,
                updated_at: new Date().toISOString(),
              });
          setStatus((s) => ({ ...s, [tipo]: error ? "erro" : "salvo" }));
        },
      );
      return fila.current[tipo];
    },
    [lojaId, profile.id],
  );

  const flush = useCallback(
    (tipo: Tipo) => {
      const p = timers.current[tipo];
      if (!p) return fila.current[tipo];
      clearTimeout(p.id);
      delete timers.current[tipo];
      return gravar(tipo, p.r);
    },
    [gravar],
  );

  // saiu da tela com gravação pendente: grava já
  useEffect(() => {
    const pend = timers.current;
    return () => {
      for (const tipo of Object.keys(pend) as Tipo[]) flush(tipo);
    };
  }, [flush]);

  const de = (tipo: Tipo) => mapa?.[tipo] ?? VAZIO;

  function alterar(tipo: Tipo, fn: (r: Rascunho) => Rascunho) {
    const r = fn(de(tipo));
    setMapa((m) => ({ ...m, [tipo]: r }));
    setStatus((s) => ({ ...s, [tipo]: "salvando" }));
    clearTimeout(timers.current[tipo]?.id);
    timers.current[tipo] = {
      r,
      id: setTimeout(() => {
        delete timers.current[tipo];
        gravar(tipo, r);
      }, ESPERA_MS),
    };
  }

  // grava o rascunho antes (se a confirmação falhar, nada se perde); o banco apaga o rascunho ao confirmar
  async function confirmar(tipo: Tipo, itens: ItemR[], comentario: string) {
    const com = campoTexto(comentario, "Comentário");
    if (com.erro) {
      toast.error(com.erro);
      return null;
    }
    await flush(tipo);
    const { data, error } = await supabase.rpc("confirmar_movimento", {
      p_loja_id: lojaId!,
      p_tipo: tipo,
      p_itens: itens,
      p_comentario: com.valor,
    });
    if (error) {
      toast.error("Lançamento não registrado", { description: error.message });
      return null;
    }
    // edição feita durante a confirmação não pode ressuscitar o rascunho: apaga de novo, na fila
    clearTimeout(timers.current[tipo]?.id);
    delete timers.current[tipo];
    gravar(tipo, VAZIO);
    setMapa((m) => ({ ...m, [tipo]: VAZIO }));
    return data as number;
  }

  return { carregado: !!mapa, de, alterar, confirmar, status };
}
type Rascunhos = ReturnType<typeof useRascunhos>;

function StatusRascunho({
  status,
  temAlgo,
}: {
  status?: Status;
  temAlgo: boolean;
}) {
  if (status === "salvando")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <LoaderCircle size={13} className="animate-spin" /> Salvando…
      </span>
    );
  if (status === "erro")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger">
        <CircleAlert size={13} /> Rascunho não salvo
      </span>
    );
  if (!temAlgo) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ok">
      <Check size={13} /> Rascunho salvo
    </span>
  );
}

/* ───────────── Estoque ───────────── */

type Filtro = "todos" | "baixo" | "zerado";

function EstoqueAba({
  linhas,
  onSaved,
  onContar,
}: {
  linhas: Linha[];
  onSaved: () => void;
  onContar: () => void;
}) {
  const loja = useNomeLoja();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [detalhe, setDetalhe] = useState<number | null>(null);

  const nBaixo = linhas.filter(baixo).length;
  const nZerado = linhas.filter((l) => l.estoque <= 0).length;
  const q = busca.trim().toLowerCase();
  const visiveis = linhas.filter(
    (l) =>
      (!q || l.nome.toLowerCase().includes(q)) &&
      (filtro === "todos" || (filtro === "baixo" ? baixo(l) : l.estoque <= 0)),
  );
  const sel = linhas.find((l) => l.produto_id === detalhe);

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-2.5 sm:gap-3">
        <Stat label="Produtos" value={num(linhas.length)} />
        <Stat label="No mínimo ou abaixo" value={num(nBaixo)} />
        <Stat label="Zerados" value={num(nZerado)} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <BuscaProduto
          value={busca}
          onChange={setBusca}
          className="min-w-52 flex-1"
        />
        <Tabs<Filtro>
          value={filtro}
          onChange={setFiltro}
          items={[
            { value: "todos", label: "Todos" },
            { value: "baixo", label: `Baixo (${nBaixo})` },
            { value: "zerado", label: `Zerados (${nZerado})` },
          ]}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Toque num produto para ver os movimentos e ajustar o mínimo.
        </p>
        <div className="flex gap-2">
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
              { titulo: "Outras saídas", tipo: "int" },
              { titulo: "Amostras abertas em", largura: 24 },
              { titulo: "Esperado", tipo: "int" },
              { titulo: "Mínimo", tipo: "int" },
              { titulo: "Contado", tipo: "campo", largura: 12 },
            ]}
            linhas={linhas.map((l) => [
              l.nome,
              l.ultimo_inventario,
              l.saldo_inventario,
              l.entradas,
              l.vendidos,
              l.amostras,
              l.outras_saidas,
              aberturasPeriodo(l)
                .map(
                  (a) =>
                    dia(a.created_at) +
                    (a.quantidade > 1 ? ` (×${a.quantidade})` : ""),
                )
                .join(", "),
              l.estoque,
              l.minimo,
              "",
            ])}
          />
          <Button onClick={onContar}>
            <ClipboardCheck size={16} /> Fazer contagem
          </Button>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <Empty>
          Nenhum produto {filtro === "todos" ? "encontrado" : "neste filtro"}.
        </Empty>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {visiveis.map((l) => (
            <button
              key={l.produto_id}
              type="button"
              onClick={() => setDetalhe(l.produto_id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-paper active:bg-paper sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{l.nome}</div>
                <div className="text-xs text-muted">
                  {l.ultimo_inventario
                    ? `Contado em ${dia(l.ultimo_inventario)} · ${diasDesde(l.ultimo_inventario)}`
                    : "Nunca contado"}
                </div>
              </div>
              {l.estoque <= 0 ? (
                <Badge tone="danger">Zerado</Badge>
              ) : (
                baixo(l) && <Badge tone="gold">Baixo</Badge>
              )}
              <div className="w-16 shrink-0 text-right">
                <div
                  className={cx(
                    "num text-xl leading-none font-semibold",
                    l.estoque <= 0 && "text-danger",
                  )}
                >
                  {l.estoque}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {l.minimo > 0 ? `mín. ${l.minimo}` : "sem mín."}
                </div>
              </div>
            </button>
          ))}
        </Card>
      )}
      {sel && (
        <DetalheProduto
          key={sel.produto_id}
          linha={sel}
          onClose={() => setDetalhe(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

type MovDetalhe = {
  created_at: string;
  quantidade: number;
  tipo: Tipo | "venda";
  comentario: string | null;
  quem: string;
};

// Movimentos desde o último inventário + ajuste do estoque mínimo
function DetalheProduto({
  linha,
  onClose,
  onSaved,
}: {
  linha: Linha;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [movs, setMovs] = useState<MovDetalhe[] | null>(null);
  const [minimo, setMinimo] = useState(String(linha.minimo));

  useEffect(() => {
    const desde = linha.ultimo_inventario ?? "1970-01-01";
    Promise.all([
      supabase
        .from("estoque_movimentos")
        .select(
          "created_at, quantidade, tipo, comentario, profiles!estoque_movimentos_created_by_fkey(nome)",
        )
        .eq("produto_id", linha.produto_id)
        .neq("tipo", "inventario")
        .gt("quantidade", 0)
        .gt("created_at", desde),
      supabase
        .from("venda_itens")
        .select(
          "quantidade, vendas!inner(created_at, anulada, vendedor:profiles!vendas_vendedor_id_fkey(nome))",
        )
        .eq("produto_id", linha.produto_id)
        .eq("vendas.anulada", false)
        .gt("vendas.created_at", desde),
    ]).then(([m, v]) => {
      const a = (
        (m.data ?? []) as unknown as (Omit<MovDetalhe, "quem"> & {
          profiles: { nome: string } | null;
        })[]
      ).map((r) => ({ ...r, quem: r.profiles?.nome ?? "—" }));
      const b = (
        (v.data ?? []) as unknown as {
          quantidade: number;
          vendas: { created_at: string; vendedor: { nome: string } };
        }[]
      ).map((r) => ({
        created_at: r.vendas.created_at,
        quantidade: r.quantidade,
        tipo: "venda" as const,
        comentario: null,
        quem: r.vendas.vendedor.nome,
      }));
      setMovs(
        [...a, ...b].sort((x, y) => y.created_at.localeCompare(x.created_at)),
      );
    });
  }, [linha]);

  async function salvarMinimo() {
    const n = Number(minimo);
    if (minimo === "" || !Number.isInteger(n) || n < 0)
      return toast.error("Mínimo precisa ser um número inteiro");
    const { error } = await supabase
      .from("produtos")
      .update({ estoque_minimo: n })
      .eq("id", linha.produto_id);
    if (error)
      return toast.error("Mínimo não salvo", { description: error.message });
    toast.success(n ? `Mínimo de ${linha.nome}: ${n}` : "Mínimo removido");
    onSaved();
  }

  const saidas = linha.vendidos + linha.amostras + linha.outras_saidas;

  return (
    <Modal open onClose={onClose} title={linha.nome}>
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl bg-paper p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold tracking-wide text-muted uppercase">
                Estoque agora
              </div>
              <div
                className={cx(
                  "num font-display text-4xl font-bold",
                  linha.estoque <= 0 && "text-danger",
                )}
              >
                {linha.estoque}
              </div>
            </div>
            {baixo(linha) && <Badge tone="gold">No mínimo ou abaixo</Badge>}
          </div>
          <div className="num mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>
              {linha.ultimo_inventario
                ? `Contagem ${dia(linha.ultimo_inventario)}`
                : "Sem contagem"}
              : <b className="text-ink">{linha.saldo_inventario}</b>
            </span>
            <span className="text-ok">+{linha.entradas} entradas</span>
            <span className="text-danger">−{saidas} saídas</span>
          </div>
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvarMinimo();
          }}
        >
          <Field label="Estoque mínimo" className="w-32">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              className="num"
            />
          </Field>
          <Button
            type="submit"
            variant="outline"
            className="h-11"
            disabled={minimo === String(linha.minimo)}
          >
            Salvar mínimo
          </Button>
        </form>

        <div>
          <h3 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
            Desde a última contagem
          </h3>
          {!movs ? (
            <p className="text-sm text-muted">Carregando…</p>
          ) : movs.length === 0 ? (
            <p className="text-sm text-muted">Nenhum movimento.</p>
          ) : (
            <ul className="divide-y divide-line">
              {movs.map((m, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                  <IconeTipo tipo={m.tipo} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {TIPOS[m.tipo].nome} · {m.quem}
                    </div>
                    <div className="text-xs text-muted">
                      {dataHora(m.created_at)}
                      {m.comentario && ` · ${m.comentario}`}
                    </div>
                  </div>
                  <Qtd tipo={m.tipo} quantidade={m.quantidade} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function IconeTipo({ tipo }: { tipo: Tipo | "venda" }) {
  const T = TIPOS[tipo];
  return (
    <span
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-xl",
        TOM_ICONE[T.tom],
      )}
    >
      <T.icone size={16} />
    </span>
  );
}

function Qtd({
  tipo,
  quantidade,
}: {
  tipo: Tipo | "venda";
  quantidade: number;
}) {
  const s = TIPOS[tipo].sinal;
  return (
    <span
      className={cx(
        "num shrink-0 font-bold",
        s > 0 && "text-ok",
        s < 0 && "text-danger",
      )}
    >
      {s > 0 ? "+" : s < 0 ? "−" : "= "}
      {num(quantidade)}
    </span>
  );
}

/* ───────────── Movimentar ───────────── */

function Movimentar({
  linhas,
  verEstoque,
  tipo,
  setTipo,
  rascunhos,
  onSaved,
}: {
  linhas: Linha[];
  verEstoque: boolean;
  tipo: Tipo;
  setTipo: (t: Tipo) => void;
  rascunhos: Rascunhos;
  onSaved: () => void;
}) {
  const { profile } = useApp();
  const podeDoar = profile.role >= 90;
  const atual = tipo === "doacao" && !podeDoar ? "amostra" : tipo;
  const T = TIPOS[atual];
  const ativos = new Set(linhas.map((l) => l.produto_id));
  const contar = (t: Tipo) =>
    rascunhos.de(t).itens.filter((i) => ativos.has(i.produto_id)).length;

  return (
    <>
      {/* Tipo: entrada / saída / conferência */}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row">
        {GRUPOS.map((g) => {
          const tipos = g.tipos.filter((t) => t !== "doacao" || podeDoar);
          return (
            <div
              key={g.titulo}
              style={{ flex: tipos.length }}
              className="min-w-0"
            >
              <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {g.titulo}
              </div>
              <div className="flex gap-2">
                {tipos.map((t) => {
                  const X = TIPOS[t];
                  const n = contar(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTipo(t)}
                      aria-pressed={t === atual}
                      className={cx(
                        "relative flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-sm font-semibold transition active:scale-[0.97] sm:flex-row sm:justify-center sm:gap-2 sm:py-3.5",
                        t === atual
                          ? "border-ink bg-ink text-white shadow-md"
                          : "border-line bg-card text-ink hover:border-ink/30",
                      )}
                    >
                      <X.icone
                        size={18}
                        className={
                          t === atual ? "text-gold-bright" : "text-muted"
                        }
                      />
                      <span className="truncate">{X.curto}</span>
                      {n > 0 && (
                        <span
                          title="Rascunho em andamento"
                          className="num absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold-bright px-1 text-[11px] font-bold text-ink"
                        >
                          {n}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mb-4 text-sm text-muted">
        <b className="text-ink">{T.nome}.</b> {T.ajuda}
      </p>

      {!rascunhos.carregado ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : atual === "inventario" ? (
        <ContagemForm
          linhas={linhas}
          verEstoque={verEstoque}
          rascunhos={rascunhos}
          onSaved={onSaved}
        />
      ) : (
        <LancamentoForm
          key={atual}
          tipo={atual}
          linhas={linhas}
          verEstoque={verEstoque}
          rascunhos={rascunhos}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function BuscaProduto({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <Search
        size={18}
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar perfume…"
        className="pl-11"
      />
    </div>
  );
}

// Compra, devolução, amostra, doação, estragou: toca no produto para adicionar; revisa e confirma
function LancamentoForm({
  tipo,
  linhas,
  verEstoque,
  rascunhos,
  onSaved,
}: {
  tipo: Exclude<Tipo, "inventario">;
  linhas: Linha[];
  verEstoque: boolean;
  rascunhos: Rascunhos;
  onSaved: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [revisar, setRevisar] = useState(false); // sheet no celular
  const [enviando, setEnviando] = useState(false);
  const T = TIPOS[tipo];
  const porId = useMemo(
    () => new Map(linhas.map((l) => [l.produto_id, l])),
    [linhas],
  );
  const r = rascunhos.de(tipo);
  const itens = r.itens.filter((i) => porId.has(i.produto_id)); // produto removido do cadastro sai do rascunho
  const unidades = itens.reduce((s, i) => s + i.quantidade, 0);
  const noLancamento = new Map(itens.map((i) => [i.produto_id, i.quantidade]));
  const q = busca.trim().toLowerCase();
  const filtradas = q
    ? linhas.filter((l) => l.nome.toLowerCase().includes(q))
    : linhas;

  const mudar = (fn: (r: Rascunho) => Rascunho) => rascunhos.alterar(tipo, fn);
  const setQtd = (id: number, qtd: number) =>
    mudar((r) => ({
      ...r,
      itens:
        qtd <= 0
          ? r.itens.filter((i) => i.produto_id !== id)
          : r.itens.some((i) => i.produto_id === id)
            ? r.itens.map((i) =>
                i.produto_id === id ? { ...i, quantidade: qtd } : i,
              )
            : [...r.itens, { produto_id: id, quantidade: qtd }],
    }));

  async function confirmar() {
    setEnviando(true);
    const n = await rascunhos.confirmar(tipo, itens, r.comentario);
    setEnviando(false);
    if (n === null) return;
    setRevisar(false);
    toast.success(`${T.nome} registrada`, {
      description: `${n} produto${n > 1 ? "s" : ""} · ${unidades} unidade${unidades > 1 ? "s" : ""} ${T.sinal > 0 ? "entraram no" : "saíram do"} estoque`,
    });
    onSaved();
  }

  function descartar() {
    if (confirm("Descartar este rascunho?")) mudar(() => VAZIO);
  }

  const resumo = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <IconeTipo tipo={tipo} />
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-bold">
              {T.nome}
            </h2>
            <StatusRascunho
              status={rascunhos.status[tipo]}
              temAlgo={itens.length > 0 || !!r.comentario}
            />
          </div>
        </div>
        {(itens.length > 0 || r.comentario) && (
          <Button variant="ghost" size="sm" onClick={descartar}>
            Descartar
          </Button>
        )}
      </div>
      {itens.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted">
          <T.icone
            size={28}
            strokeWidth={1.5}
            className="mx-auto mb-2 text-gold"
          />
          Toque nos produtos para adicionar ao lançamento.
        </div>
      ) : (
        <ul className="divide-y divide-line lg:max-h-[45dvh] lg:overflow-y-auto lg:overscroll-contain">
          {itens.map((i) => (
            <li
              key={i.produto_id}
              className="flex items-center gap-2 px-5 py-2.5"
            >
              <span className="min-w-0 flex-1 text-sm leading-snug font-semibold">
                {porId.get(i.produto_id)!.nome}
              </span>
              <Stepper
                valor={i.quantidade}
                onChange={(n) => setQtd(i.produto_id, n)}
              />
              <button
                type="button"
                onClick={() => setQtd(i.produto_id, 0)}
                aria-label="Remover"
                className="-mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <Textarea
          aria-label="Comentário"
          maxLength={MAX_TEXTO}
          placeholder={
            tipo === "entrada"
              ? "Fornecedor, nota fiscal… (opcional)"
              : "Comentário (opcional)"
          }
          value={r.comentario}
          onChange={(e) => mudar((r) => ({ ...r, comentario: e.target.value }))}
        />
        <Button
          size="lg"
          disabled={itens.length === 0 || enviando}
          onClick={confirmar}
        >
          {enviando ? (
            <LoaderCircle size={18} className="animate-spin" />
          ) : (
            <Check size={18} />
          )}
          Confirmar{" "}
          {unidades > 0 && `· ${T.sinal > 0 ? "+" : "−"}${unidades} un.`}
        </Button>
      </div>
    </>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section>
        <BuscaProduto value={busca} onChange={setBusca} className="mb-3" />
        <Card className="divide-y divide-line overflow-hidden">
          {filtradas.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Nenhum perfume encontrado.
            </p>
          )}
          {filtradas.map((l) => {
            const n = noLancamento.get(l.produto_id);
            return (
              <button
                key={l.produto_id}
                type="button"
                onClick={() => setQtd(l.produto_id, (n ?? 0) + 1)}
                className={cx(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-gold-soft/50 sm:px-5",
                  n ? "bg-gold-soft/40" : "hover:bg-paper",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {l.nome}
                  </span>
                  {verEstoque && (
                    <span
                      className={cx(
                        "num text-xs",
                        l.estoque <= 0 ? "text-danger" : "text-muted",
                      )}
                    >
                      estoque {l.estoque}
                    </span>
                  )}
                </span>
                {n ? (
                  <Badge tone="gold">{n} no lançamento</Badge>
                ) : (
                  <span className="grid size-8 place-items-center rounded-full border border-line text-muted">
                    <Plus size={15} />
                  </span>
                )}
              </button>
            );
          })}
        </Card>
      </section>

      <Card className="hidden lg:sticky lg:top-22 xl:top-8 lg:block">
        {resumo}
      </Card>

      <BarraCelular
        visivel={itens.length > 0}
        titulo={`${itens.length} produto${itens.length > 1 ? "s" : ""}`}
        valor={`${T.sinal > 0 ? "+" : "−"}${unidades} un.`}
        acao="Revisar"
        onClick={() => setRevisar(true)}
      />
      <Modal
        open={revisar && itens.length > 0}
        onClose={() => setRevisar(false)}
        title="Revisar lançamento"
      >
        <div className="-m-5 sm:-m-6">{resumo}</div>
      </Modal>
    </div>
  );
}

// Celular: barra flutuante acima da navegação (mesmo padrão do caixa)
function BarraCelular({
  visivel,
  titulo,
  valor,
  acao,
  onClick,
}: {
  visivel: boolean;
  titulo: string;
  valor: ReactNode;
  acao: string;
  onClick: () => void;
}) {
  if (!visivel) return null;
  return (
    <>
      <div aria-hidden className="h-20 lg:hidden" />
      <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-[calc(1rem+env(safe-area-inset-bottom))] md:left-[6.25rem] z-20 flex items-center gap-2 rounded-2xl bg-ink p-2 pl-4 text-white shadow-lift ring-1 ring-white/10 lg:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-white/60">{titulo}</span>
          <span className="num block truncate font-display text-xl leading-tight font-bold">
            {valor}
          </span>
        </span>
        <Button variant="gold" size="lg" className="px-5" onClick={onClick}>
          {acao}
        </Button>
      </div>
    </>
  );
}

// key={valor}: remonta quando muda pelos botões; digitação confirma no blur/Enter
function Stepper({
  valor,
  onChange,
}: {
  valor: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-xl border border-line">
      <button
        type="button"
        aria-label="Diminuir"
        disabled={valor <= 1}
        onClick={() => onChange(valor - 1)}
        className="grid size-9 place-items-center rounded-l-xl text-muted hover:text-ink active:bg-ink/5 disabled:opacity-30"
      >
        <Minus size={14} />
      </button>
      <QtdInput key={valor} valor={valor} onCommit={onChange} />
      <button
        type="button"
        aria-label="Aumentar"
        onClick={() => onChange(valor + 1)}
        className="grid size-9 place-items-center rounded-r-xl text-muted hover:text-ink active:bg-ink/5"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function QtdInput({
  valor,
  onCommit,
}: {
  valor: number;
  onCommit: (n: number) => void;
}) {
  const [v, setV] = useState(String(valor));
  const commit = () => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n !== valor) onCommit(n);
    else setV(String(valor));
  };
  return (
    <input
      inputMode="numeric"
      aria-label="Quantidade"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="num h-9 w-10 bg-transparent text-center text-base font-semibold focus:outline-none sm:text-sm"
    />
  );
}

// Contagem: todos os produtos com campo "contado"; administração vê esperado e diferença, demais contam às cegas
function ContagemForm({
  linhas,
  verEstoque,
  rascunhos,
  onSaved,
}: {
  linhas: Linha[];
  verEstoque: boolean;
  rascunhos: Rascunhos;
  onSaved: () => void;
}) {
  const [busca, setBusca] = useState("");
  // "Faltam": fotografa os não contados ao ligar; senão a linha some no primeiro dígito digitado
  const [faltando, setFaltando] = useState<Set<number> | null>(null);
  const [enviando, setEnviando] = useState(false);
  const r = rascunhos.de("inventario");
  const ativos = new Set(linhas.map((l) => l.produto_id));
  const itens = r.itens.filter((i) => ativos.has(i.produto_id));
  const contado = new Map(itens.map((i) => [i.produto_id, i.quantidade]));
  const q = busca.trim().toLowerCase();
  const visiveis = linhas.filter(
    (l) =>
      (!q || l.nome.toLowerCase().includes(q)) &&
      (!faltando || faltando.has(l.produto_id)),
  );
  const difs = verEstoque
    ? itens.filter(
        (i) =>
          i.quantidade !==
          linhas.find((l) => l.produto_id === i.produto_id)!.estoque,
      ).length
    : 0;

  const mudar = (fn: (r: Rascunho) => Rascunho) =>
    rascunhos.alterar("inventario", fn);
  const setContado = (id: number, v: string) =>
    mudar((r) => {
      const outros = r.itens.filter((i) => i.produto_id !== id);
      const n = Number(v);
      return {
        ...r,
        itens:
          v === "" || !Number.isInteger(n) || n < 0
            ? outros
            : [...outros, { produto_id: id, quantidade: n }],
      };
    });

  async function confirmar() {
    if (
      !confirm(
        `Registrar a contagem de ${itens.length} produto${itens.length > 1 ? "s" : ""}?`,
      )
    )
      return;
    setEnviando(true);
    const n = await rascunhos.confirmar("inventario", itens, r.comentario);
    setEnviando(false);
    if (n === null) return;
    toast.success("Contagem registrada", {
      description: verEstoque
        ? difs
          ? `${difs} produto${difs > 1 ? "s" : ""} com diferença`
          : "Tudo bateu"
        : undefined,
    });
    onSaved();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <BuscaProduto
          value={busca}
          onChange={setBusca}
          className="min-w-52 flex-1"
        />
        <Tabs
          value={faltando ? "p" : "t"}
          onChange={(v) =>
            setFaltando(
              v === "p"
                ? new Set(
                    linhas
                      .filter((l) => !contado.has(l.produto_id))
                      .map((l) => l.produto_id),
                  )
                : null,
            )
          }
          items={[
            { value: "t", label: "Todos" },
            { value: "p", label: `Faltam (${linhas.length - itens.length})` },
          ]}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="divide-y divide-line overflow-hidden">
          {visiveis.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {faltando
                ? "Todos os produtos foram contados."
                : "Nenhum perfume encontrado."}
            </p>
          )}
          {visiveis.map((l) => {
            const c = contado.get(l.produto_id);
            const dif = c === undefined ? null : c - l.estoque;
            return (
              <label
                key={l.produto_id}
                className={cx(
                  "flex items-center gap-3 px-4 py-2.5 sm:px-5",
                  c !== undefined && "bg-ok-soft/40",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {l.nome}
                  </span>
                  {verEstoque && (
                    <span className="num text-xs text-muted">
                      esperado {l.estoque}
                      {dif !== null &&
                        (dif === 0 ? (
                          <span className="text-ok"> · bateu</span>
                        ) : (
                          <span className="text-danger">
                            {" "}
                            · {dif > 0 ? "+" : "−"}
                            {Math.abs(dif)}
                          </span>
                        ))}
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  enterKeyHint="next"
                  placeholder="—"
                  aria-label={`Contado de ${l.nome}`}
                  value={c ?? ""}
                  onChange={(e) => setContado(l.produto_id, e.target.value)}
                  className="num h-11 w-20 rounded-xl border border-line bg-card px-2 text-center text-base font-semibold transition focus:border-gold focus:ring-4 focus:ring-gold/15 focus:outline-none"
                />
              </label>
            );
          })}
        </Card>

        <Card className="flex flex-col gap-3 p-5 lg:sticky lg:top-22 xl:top-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="num font-display text-3xl font-bold">
                {itens.length}
                <span className="text-lg text-muted"> / {linhas.length}</span>
              </div>
              <div className="text-xs text-muted">produtos contados</div>
            </div>
            <StatusRascunho
              status={rascunhos.status.inventario}
              temAlgo={itens.length > 0 || !!r.comentario}
            />
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-ok transition-[width]"
              style={{ width: `${(itens.length / linhas.length) * 100}%` }}
            />
          </div>
          {verEstoque && itens.length > 0 && (
            <p className="text-sm text-muted">
              {difs ? (
                <>
                  <b className="text-danger">{difs}</b> com diferença do
                  esperado
                </>
              ) : (
                "Até agora tudo bateu com o esperado."
              )}
            </p>
          )}
          <Textarea
            aria-label="Comentário"
            maxLength={MAX_TEXTO}
            placeholder="Comentário (opcional)"
            value={r.comentario}
            onChange={(e) =>
              mudar((r) => ({ ...r, comentario: e.target.value }))
            }
          />
          <p className="text-xs text-muted">
            Pode parar e continuar depois, inclusive em outro aparelho. Só os
            produtos preenchidos são registrados.
          </p>
          <div className="flex gap-2">
            {(itens.length > 0 || r.comentario) && (
              <Button
                variant="ghost"
                onClick={() =>
                  confirm("Descartar a contagem em andamento?") &&
                  mudar(() => VAZIO)
                }
              >
                Descartar
              </Button>
            )}
            <Button
              className="flex-1"
              size="lg"
              disabled={itens.length === 0 || enviando}
              onClick={confirmar}
            >
              {enviando ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <ClipboardCheck size={18} />
              )}
              Registrar contagem
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ───────────── Histórico ───────────── */

type Mov = Amostra & {
  tipo: Tipo | "venda";
  saldo_anterior: number | null;
  entradas: number | null;
  saidas: number | null;
};
type FiltroTipo = "todos" | "entradas" | "saidas" | Tipo | "venda";

const diasAtras = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toLocaleDateString("sv-SE", {
    timeZone: TZ,
  });
const esperadoInv = (m: Mov) =>
  (m.saldo_anterior ?? 0) + (m.entradas ?? 0) - (m.saidas ?? 0);

function Historico({ onSaved }: { onSaved: () => void }) {
  const { lojaId, profile } = useApp();
  const loja = useNomeLoja();
  const [de, setDe] = useState(() => diasAtras(6));
  const [ate, setAte] = useState(hojeISO);
  const [filtro, setFiltro] = useState<FiltroTipo>("todos");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Mov | null>(null);

  const buscar = useCallback(async () => {
    const ini = intervaloDia(de).de;
    const fim = intervaloDia(ate).ate;
    const [m, v] = await Promise.all([
      supabase
        .from("estoque_movimentos")
        .select(
          `id, produto_id, tipo, quantidade, comentario, created_at, created_by, editado_em,
           saldo_anterior, entradas, saidas,
           produtos!inner(nome, loja_id),
           abriu:profiles!estoque_movimentos_created_by_fkey(nome),
           editou:profiles!estoque_movimentos_editado_por_fkey(nome)`,
        )
        .eq("produtos.loja_id", lojaId!)
        .gte("created_at", ini)
        .lte("created_at", fim),
      supabase
        .from("venda_itens")
        .select(
          "id, produto_id, quantidade, produtos(nome), vendas!inner(created_at, anulada, loja_id, vendedor:profiles!vendas_vendedor_id_fkey(nome))",
        )
        .eq("vendas.loja_id", lojaId!)
        .eq("vendas.anulada", false)
        .gte("vendas.created_at", ini)
        .lte("vendas.created_at", fim),
    ]);
    if (m.error || v.error)
      toast.error("Erro ao carregar histórico", {
        description: (m.error ?? v.error)!.message,
      });
    const vendas = (
      (v.data ?? []) as unknown as {
        id: number;
        produto_id: number;
        quantidade: number;
        produtos: { nome: string };
        vendas: { created_at: string; vendedor: { nome: string } };
      }[]
    ).map((r): Mov => ({
      id: -r.id, // não colide com movimentos
      produto_id: r.produto_id,
      tipo: "venda",
      quantidade: r.quantidade,
      comentario: null,
      created_at: r.vendas.created_at,
      created_by: null,
      editado_em: null,
      produtos: r.produtos,
      abriu: r.vendas.vendedor,
      editou: null,
      saldo_anterior: null,
      entradas: null,
      saidas: null,
    }));
    return {
      chave: `${de}|${ate}`,
      movs: [...((m.data ?? []) as unknown as Mov[]), ...vendas].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    };
  }, [lojaId, de, ate]);
  const [data, carregar] = useData(buscar);
  const movs = data?.chave === `${de}|${ate}` ? data.movs : null;

  const q = busca.trim().toLowerCase();
  const visiveis = (movs ?? []).filter(
    (m) =>
      (!q || m.produtos.nome.toLowerCase().includes(q)) &&
      (filtro === "todos" ||
        (filtro === "entradas"
          ? TIPOS[m.tipo].sinal > 0
          : filtro === "saidas"
            ? TIPOS[m.tipo].sinal < 0
            : m.tipo === filtro)),
  );
  const podeEditar = (m: Mov) =>
    m.tipo === "amostra" && (profile.role >= 90 || m.created_by === profile.id);

  // agrupa por dia (lista já vem ordenada)
  const grupos: { dia: string; movs: Mov[] }[] = [];
  for (const m of visiveis) {
    const d = dia(m.created_at);
    if (grupos.at(-1)?.dia !== d) grupos.push({ dia: d, movs: [] });
    grupos.at(-1)!.movs.push(m);
  }

  return (
    <>
      <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[9.5rem_9.5rem_13rem_minmax(0,1fr)_auto] lg:items-end">
        <div className="grid grid-cols-2 gap-2.5 sm:col-span-2 lg:contents">
          <Field label="De">
            <Input
              type="date"
              value={de}
              max={ate}
              onChange={(e) => e.target.value && setDe(e.target.value)}
            />
          </Field>
          <Field label="Até">
            <Input
              type="date"
              value={ate}
              min={de}
              max={hojeISO()}
              onChange={(e) => e.target.value && setAte(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Tipo">
          <Select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as FiltroTipo)}
          >
            <option value="todos">Todos</option>
            <option value="entradas">Todas as entradas</option>
            <option value="saidas">Todas as saídas</option>
            {(Object.keys(TIPOS) as (Tipo | "venda")[]).map((t) => (
              <option key={t} value={t}>
                {TIPOS[t].nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Produto">
          <BuscaProduto value={busca} onChange={setBusca} />
        </Field>
        <Exportar
          arquivo={`movimentos-${de}-a-${ate}`}
          titulo={`Movimentos de estoque — ${loja}`}
          subtitulo={`${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")}`}
          paisagem
          colunas={[
            { titulo: "Data", tipo: "data" },
            { titulo: "Tipo", largura: 18 },
            { titulo: "Perfume", largura: 32 },
            { titulo: "Qtd", tipo: "dif" },
            { titulo: "Esperado (contagem)", tipo: "int" },
            { titulo: "Por", largura: 20 },
            { titulo: "Comentário", largura: 30 },
          ]}
          linhas={visiveis.map((m) => [
            m.created_at,
            TIPOS[m.tipo].nome,
            m.produtos.nome,
            TIPOS[m.tipo].sinal < 0 ? -m.quantidade : m.quantidade,
            m.tipo === "inventario" ? esperadoInv(m) : null,
            m.abriu?.nome ?? "",
            m.comentario,
          ])}
        />
      </div>

      {!movs ? (
        <p className="py-8 text-center text-sm text-muted">Carregando…</p>
      ) : grupos.length === 0 ? (
        <Empty>Nenhum movimento neste período.</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {grupos.map((g) => (
            <section key={g.dia}>
              <h3 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
                {g.dia}
              </h3>
              <Card className="divide-y divide-line">
                {g.movs.map((m) => (
                  <LinhaHistorico
                    key={`${m.tipo}-${m.id}`}
                    m={m}
                    onEditar={podeEditar(m) ? () => setEditando(m) : undefined}
                  />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      {editando && (
        <EditarAmostra
          key={editando.id}
          amostra={editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            carregar();
            onSaved();
          }}
        />
      )}
    </>
  );
}

function LinhaHistorico({ m, onEditar }: { m: Mov; onEditar?: () => void }) {
  const cancelada = m.tipo !== "inventario" && m.quantidade === 0;
  const dif = m.tipo === "inventario" ? m.quantidade - esperadoInv(m) : 0;
  return (
    <div
      className={cx(
        "flex items-center gap-3 px-4 py-3 sm:px-5",
        cancelada && "opacity-55",
      )}
    >
      <IconeTipo tipo={m.tipo} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{m.produtos.nome}</div>
        <div className="text-xs text-muted">
          {TIPOS[m.tipo].nome} · {m.abriu?.nome ?? "—"} · {hora(m.created_at)}
          {m.comentario && ` · ${m.comentario}`}
        </div>
        {m.editado_em && (
          <div className="text-[11px] text-gold-ink">
            editada por {m.editou?.nome ?? "—"} · {dataHora(m.editado_em)}
          </div>
        )}
      </div>
      {cancelada ? (
        <Badge tone="danger">cancelada</Badge>
      ) : m.tipo === "inventario" ? (
        <span className="shrink-0 text-right">
          <span className="num block font-bold">= {m.quantidade}</span>
          <span
            className={cx(
              "num block text-[11px]",
              dif === 0 ? "text-ok" : "text-danger",
            )}
          >
            {dif === 0
              ? "bateu"
              : `${dif > 0 ? "+" : "−"}${Math.abs(dif)} do esperado`}
          </span>
        </span>
      ) : (
        <Qtd tipo={m.tipo} quantidade={m.quantidade} />
      )}
      {onEditar && (
        <Button
          variant="ghost"
          size="sm"
          className="-my-1 -mr-2 size-9 px-0"
          aria-label={`Editar amostra de ${m.produtos.nome}`}
          onClick={onEditar}
        >
          <Pencil size={15} />
        </Button>
      )}
    </div>
  );
}

function EditarAmostra({
  amostra,
  onClose,
  onSaved,
}: {
  amostra: Amostra;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qtd, setQtd] = useState(String(amostra.quantidade));
  const [comentario, setComentario] = useState(amostra.comentario ?? "");
  const [salvando, setSalvando] = useState(false);
  const n = Number(qtd);
  const valido = qtd !== "" && Number.isInteger(n) && n >= 0;

  async function salvar(quantidade = n) {
    const com = campoTexto(comentario, "Comentário");
    if (com.erro) return toast.error(com.erro);
    setSalvando(true);
    const { error } = await supabase.rpc("editar_amostra", {
      p_id: amostra.id,
      p_quantidade: quantidade,
      p_comentario: com.valor,
    });
    setSalvando(false);
    if (error)
      return toast.error("Amostra não alterada", {
        description: error.message,
      });
    toast.success(
      quantidade === 0
        ? "Amostra cancelada — a unidade voltou ao estoque"
        : "Amostra atualizada",
    );
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
            Aberta por {amostra.abriu?.nome ?? "—"} em{" "}
            {dataHora(amostra.created_at)}
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
            <Input
              value={comentario}
              maxLength={MAX_TEXTO}
              onChange={(e) => setComentario(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          A alteração fica registrada com o seu nome. Quantidade 0 cancela a
          amostra e devolve a unidade ao estoque.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {amostra.quantidade > 0 ? (
            <Button
              variant="danger"
              size="sm"
              disabled={salvando}
              onClick={() => salvar(0)}
            >
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
