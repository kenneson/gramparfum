"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/use-data";
import Image from "next/image";
import { Ban, LoaderCircle, MousePointerClick, Pencil, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { FORMAS, dataHora, hojeISO, hora, money, num } from "@/lib/domain";
import { TIPO_MOV, movimentosDoDia, porTipoEProduto } from "@/lib/amostras";
import { Justificar } from "@/components/justificar";
import { MAX_MOTIVO, campoTexto } from "@/lib/texto";
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
  Tabela,
  Tabs,
  Textarea,
  cx,
} from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";
import { ICONES, Pagamento } from "../caixa/pagamento";
import { Exportar } from "@/components/exportar";
import { anularComChefe } from "./actions";

// Vem de relatorio_vendas. Perfil < 100 em vários dias: total, troco e preco vêm null e só pagamentos em dinheiro.
type Venda = {
  id: number;
  created_at: string;
  total: number;
  troco: number;
  devolvido: number | null; // valor devolvido ao cliente nesta venda (devoluções no caixa)
  anulada: boolean;
  anulacao: { motivo: string | null; por: string | null; em: string | null } | null; // motivo null = anulada no sistema antigo
  vendedor_id: string;
  vendedor: { nome: string };
  operador: { nome: string } | null;
  venda_itens: {
    produto_id: number;
    preco: number;
    quantidade: number;
    valor_combo: number;
    produtos: { nome: string };
  }[];
  venda_pagamentos: { forma: number; valor: number; comentario: string | null }[];
};

type Aba = "detalhado" | "combos" | "produtos" | "fechamento";

// Vem de relatorio_caixa (mesma regra de valores do relatorio_vendas)
type Devolucao = {
  id: number;
  created_at: string;
  venda_id: number;
  vendedor_id: string;
  vendedor: string;
  por: string | null;
  motivo: string;
  volta_estoque: boolean;
  devolve_valor: boolean;
  forma: number | null;
  valor: number | null;
  desfeita: boolean;
  itens: { produto_id: number; nome: string; quantidade: number; valor_combo: number }[];
};
type Recuperacao = {
  id: number;
  created_at: string;
  tipo: "valor" | "produto" | "acerto";
  forma: number | null;
  valor: number;
  quantidade: number | null; // só administração
  produto: string | null;
  pessoa: string | null;
};
type Caixa = { devolucoes: Devolucao[]; recuperacoes: Recuperacao[] };

const supabase = createClient();
const nVenda = (id: number) => String(id).padStart(6, "0");
const combos = (v: Venda) => v.venda_itens.reduce((s, i) => s + Number(i.valor_combo) * i.quantidade, 0);
// devolução que conta: ativa e com o dinheiro devolvido (é como cancelar a venda desses produtos)
const conta = (d: Devolucao) => d.devolve_valor && !d.desfeita;
const combosDev = (d: Devolucao) => d.itens.reduce((s, i) => s + Number(i.valor_combo) * i.quantidade, 0);

export function Relatorios() {
  const { lojaId, t, profile } = useApp();
  const [aba, setAba] = useState<Aba>("detalhado");
  const [d1Escolhido, setD1] = useState(hojeISO);
  const [d2, setD2] = useState(hojeISO);
  const [aberta, setAberta] = useState<Venda | null>(null);
  const [editando, setEditando] = useState<Venda | null>(null);
  // Faturamento só para a Administração. Vendedor/chefe: valores só do dia de hoje (fechamento de caixa);
  // outros períodos só em quantidade de combos/produtos. A regra vale também no banco.
  const restrito = profile.role < 100;
  const umDia = aba === "fechamento" || (restrito && aba === "detalhado");
  const soHoje = restrito && umDia;
  const d1 = soHoje ? hojeISO() : d1Escolhido;
  const ate = umDia ? d1 : d2;

  const chave = `${d1}|${ate}`;
  const buscar = useCallback(async () => {
    if (!lojaId) return null;
    // ponytail: agrega no cliente; agregar no SQL se o volume por período passar de alguns milhares
    const p = { p_loja_id: lojaId, p_de: d1, p_ate: ate };
    const [v, c] = await Promise.all([supabase.rpc("relatorio_vendas", p), supabase.rpc("relatorio_caixa", p)]);
    if (v.error || c.error)
      toast.error("Erro ao carregar vendas", { description: (v.error ?? c.error)!.message });
    return {
      chave: `${d1}|${ate}`,
      vendas: (v.data ?? []) as Venda[],
      caixa: (c.data ?? { devolucoes: [], recuperacoes: [] }) as Caixa,
    };
  }, [lojaId, d1, ate]);
  const [data, carregar] = useData(buscar);
  const vendas = data?.chave === chave ? data.vendas : null; // null = carregando o período atual
  const caixa = data?.caixa ?? { devolucoes: [], recuperacoes: [] };

  if (!lojaId) return <SemLoja />;

  return (
    <>
      <PageHeader
        title={t.relatorios}
        actions={
          <Tabs<Aba>
            value={aba}
            onChange={setAba}
            items={[
              { value: "detalhado", label: "Detalhado" },
              { value: "combos", label: "Combos" },
              { value: "produtos", label: "Produtos" },
              { value: "fechamento", label: "Fechamento do dia" },
            ]}
          />
        }
      />
      {soHoje ? (
        <p className="mb-6 rounded-xl bg-card px-4 py-3 text-sm text-muted shadow-card">
          <b className="text-ink">Hoje, {d1.split("-").reverse().join("/")}.</b> Os valores aparecem só do dia de hoje, para
          o fechamento de caixa. Para outros dias, veja a quantidade de combos em <b className="text-ink">Combos</b>.
        </p>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:flex">
          <Field label={umDia ? "Dia" : "De"}>
            <Input
              type="date"
              value={d1}
              max={umDia ? undefined : d2}
              onChange={(e) => {
                setD1(e.target.value);
                if (umDia) setD2(e.target.value);
              }}
            />
          </Field>
          {!umDia && (
            <Field label="Até">
              <Input type="date" value={d2} min={d1} onChange={(e) => setD2(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      {restrito && !umDia && (
        <p className="-mt-3 mb-5 text-xs text-muted">Em vários dias só aparecem quantidades, sem valores.</p>
      )}

      {vendas === null ? (
        <div className="grid place-items-center py-20 text-muted">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : aba === "detalhado" ? (
        <Detalhado vendas={vendas} onAbrir={setAberta} />
      ) : aba === "fechamento" ? (
        <Fechamento key={d1} vendas={vendas} caixa={caixa} dia={d1} onChange={carregar} />
      ) : aba === "combos" ? (
        restrito ? (
          <CombosEquipe de={d1} ate={ate} />
        ) : (
          <Combos vendas={vendas.filter((v) => !v.anulada)} devolucoes={caixa.devolucoes.filter(conta)} />
        )
      ) : (
        <Produtos vendas={vendas.filter((v) => !v.anulada)} restrito={restrito} />
      )}

      {aberta && (
        <Ticket
          key={aberta.id}
          venda={aberta}
          onClose={() => setAberta(null)}
          onChange={carregar}
          onEditar={() => {
            setEditando(aberta);
            setAberta(null);
          }}
        />
      )}
      {editando && (
        <EditarVenda
          key={editando.id}
          venda={editando}
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

function Detalhado({ vendas, onAbrir }: { vendas: Venda[]; onAbrir: (v: Venda) => void }) {
  const { idioma } = useApp();
  const [vendedor, setVendedor] = useState("");
  const [forma, setForma] = useState(0);

  const vendedores = useMemo(
    () =>
      [...new Map(vendas.map((v) => [v.vendedor_id, v.vendedor.nome])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [vendas],
  );
  const lista = vendas.filter(
    (v) => (!vendedor || v.vendedor_id === vendedor) && (!forma || v.venda_pagamentos.some((p) => p.forma === forma)),
  );
  const validas = lista.filter((v) => !v.anulada);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-xl">
        <Field label="Vendedor">
          <Select value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            <option value="">Todos</option>
            {vendedores.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(Number(e.target.value))}>
            <option value={0}>Todas</option>
            {Object.entries(FORMAS).map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:max-w-xl">
        <Stat
          label="Vendas"
          value={money(
            validas.reduce((s, v) => s + Number(v.total), 0),
            idioma,
          )}
          hint={`${validas.length} vendas`}
        />
        <Stat
          label="Combos"
          value={num(
            validas.reduce((s, v) => s + combos(v), 0),
            2,
          )}
        />
      </div>

      {/* os cartões ignoram o filtro de forma (senão as outras formas encolhem); tocar num cartão filtra a lista */}
      <FormasPagamento
        vendas={vendas.filter((v) => !v.anulada && (!vendedor || v.vendedor_id === vendedor))}
        forma={forma}
        onForma={setForma}
      />

      {lista.length === 0 ? (
        <Empty>Nenhuma venda no período.</Empty>
      ) : (
        <>
        <p className="mb-2 flex items-center gap-1.5 text-sm text-muted">
          <MousePointerClick size={16} className="shrink-0 text-gold" />
          Toque numa venda para ver o ticket, <b className="text-ink">anular</b> ou{" "}
          <b className="text-ink">trocar o vendedor</b>.
        </p>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {lista.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(v)}
                  className={cx(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 text-left transition hover:bg-paper active:bg-paper sm:grid-cols-[90px_1fr_auto_auto] sm:px-5",
                    v.anulada && "opacity-50",
                  )}
                >
                  <span className="num min-w-0 text-sm font-bold">
                    #{nVenda(v.id)}
                    <span className="block text-xs font-normal text-muted">{dataHora(v.created_at)}</span>
                    <span className="block truncate text-xs font-semibold text-ink sm:hidden">{v.vendedor.nome}</span>
                    <span className="flex flex-wrap gap-1 pt-1 font-normal sm:hidden">
                      <Pagos venda={v} />
                    </span>
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className="block truncate text-sm font-semibold">{v.vendedor.nome}</span>
                    <span className="flex flex-wrap gap-1 pt-1">
                      <Pagos venda={v} />
                    </span>
                  </span>
                  <span className="num hidden text-right text-sm text-gold-ink sm:block">{num(combos(v), 2)}</span>
                  <span
                    className={cx("num text-right font-display text-xl font-bold", v.anulada && "line-through")}
                  >
                    {money(v.total, idioma)}
                    {v.anulada && (
                      <span className="block font-sans text-[11px] font-semibold text-danger no-underline">
                        ANULADA
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        </>
      )}
    </>
  );
}

// Nomes como o cliente confere no fechamento; Link de pagamento só aparece se tiver valor no período
const FORMAS_RELATORIO: [number, string][] = [
  [1, "Pix"],
  [2, "Dinheiro"],
  [3, "Cartão de crédito"],
  [4, "Cartão de débito à vista"],
  [5, "Link de pagamento"],
];
const pagoEm = (v: Venda, f: number) =>
  v.venda_pagamentos.filter((p) => p.forma === f).reduce((s, p) => s + Number(p.valor), 0);

// Quanto entrou em cada forma (dinheiro já sem o troco, como fica no caixa). Tocar num cartão filtra a lista.
function FormasPagamento({
  vendas,
  forma,
  onForma,
}: {
  vendas: Venda[];
  forma: number;
  onForma: (f: number) => void;
}) {
  const { idioma } = useApp();
  const formas = FORMAS_RELATORIO.map(([f, nome]) => ({
    f,
    nome,
    valor: vendas.reduce((s, v) => s + pagoEm(v, f), 0),
    vendas: vendas.filter((v) => v.venda_pagamentos.some((p) => p.forma === f)).length,
  })).filter((x) => x.f !== 5 || x.valor > 0);
  const total = formas.reduce((s, x) => s + x.valor, 0);

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xs font-bold tracking-wide text-muted uppercase">Formas de pagamento</h2>
        <span className="num text-sm text-muted">
          Total recebido <b className="font-display text-lg text-ink">{money(total, idioma)}</b>
        </span>
      </div>
      <div className={cx("grid grid-cols-2 gap-3", formas.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {formas.map(({ f, nome, valor, vendas: n }) => {
          const Icon = ICONES[f as keyof typeof ICONES];
          const ativo = forma === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onForma(ativo ? 0 : f)}
              aria-pressed={ativo}
              className={cx(
                "min-w-0 rounded-2xl border bg-card p-3.5 text-left shadow-card transition sm:p-4",
                ativo ? "border-gold ring-2 ring-gold/30" : "border-line/80 hover:border-ink/25",
              )}
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-muted sm:text-sm">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-ink">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 leading-tight">{nome}</span>
              </span>
              <span
                className={cx(
                  "num mt-2 block font-display text-2xl leading-tight font-bold break-words sm:text-3xl",
                  !valor && "text-muted/60",
                )}
              >
                {money(valor, idioma)}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {n === 1 ? "1 venda" : `${n} vendas`}
                {f === 2 && " · já sem o troco"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Formas da venda com o valor de cada uma, para conferir venda a venda
function Pagos({ venda }: { venda: Venda }) {
  const { idioma } = useApp();
  return venda.venda_pagamentos.map((p, i) => (
    <Badge key={i}>
      {FORMAS[p.forma]} <span className="num ml-1 text-ink">{money(p.valor, idioma)}</span>
    </Badge>
  ));
}

// Vendedor e chefe: combos de toda a equipe no período (relatorio_combos), só quantidades — sem valores em R$
function CombosEquipe({ de, ate }: { de: string; ate: string }) {
  const { lojaId, profile } = useApp();
  const chave = `${de}|${ate}`;
  const buscar = useCallback(async () => {
    const { data, error } = await supabase.rpc("relatorio_combos", { p_loja_id: lojaId!, p_de: de, p_ate: ate });
    if (error) toast.error("Erro ao carregar combos", { description: error.message });
    type L = { vendedor_id: string; nome: string; combos: number; vendas: number };
    return { chave: `${de}|${ate}`, linhas: (data ?? []) as L[] };
  }, [lojaId, de, ate]);
  const [data] = useData(buscar);

  if (data?.chave !== chave)
    return (
      <div className="grid place-items-center py-20 text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  const linhas = data.linhas;
  if (linhas.length === 0) return <Empty>Nenhuma venda no período.</Empty>;

  return (
    <>
      <p className="mb-3 text-sm text-muted">Combos de todos os vendedores da loja no período.</p>
      <Tabela
        head={["Vendedor", "Vendas", "Combos"]}
        rows={linhas.map((l) => [
          l.vendedor_id === profile.id ? <b key="n">{l.nome} (você)</b> : l.nome,
          num(l.vendas),
          num(Number(l.combos), 2),
        ])}
        foot={[
          "Total",
          num(linhas.reduce((s, l) => s + l.vendas, 0)),
          num(
            linhas.reduce((s, l) => s + Number(l.combos), 0),
            2,
          ),
        ]}
      />
    </>
  );
}

// Combos por vendedor; devolução com valor devolvido tira os combos (na data da devolução, como no ranking)
function Combos({ vendas, devolucoes }: { vendas: Venda[]; devolucoes: Devolucao[] }) {
  const { idioma } = useApp();
  type L = { nome: string; combos: number; dinheiro: number; vendas: number };
  const mapa = vendas.reduce((m, v) => {
    const r = m.get(v.vendedor_id) ?? { nome: v.vendedor.nome, combos: 0, dinheiro: 0, vendas: 0 };
    r.combos += combos(v);
    r.vendas += Number(v.total);
    r.dinheiro += pagoEm(v, 2);
    return m.set(v.vendedor_id, r);
  }, new Map<string, L>());
  for (const d of devolucoes) {
    const r = mapa.get(d.vendedor_id) ?? { nome: d.vendedor, combos: 0, dinheiro: 0, vendas: 0 };
    r.combos -= combosDev(d);
    mapa.set(d.vendedor_id, r);
  }
  const linhas = [...mapa.values()].sort((a, b) => b.combos - a.combos);

  if (linhas.length === 0) return <Empty>Nenhuma venda no período.</Empty>;
  const soma = (k: "combos" | "dinheiro" | "vendas") => linhas.reduce((s, l) => s + l[k], 0);

  return (
    <Tabela
      head={["Vendedor", "Combos", "Dinheiro", "Vendas"]}
      rows={linhas.map((l) => [l.nome, num(l.combos, 2), money(l.dinheiro, idioma), money(l.vendas, idioma)])}
      foot={["Total", num(soma("combos"), 2), money(soma("dinheiro"), idioma), money(soma("vendas"), idioma)]}
    />
  );
}

function Produtos({ vendas, restrito }: { vendas: Venda[]; restrito: boolean }) {
  const { idioma } = useApp();
  const [produto, setProduto] = useState(0);
  const mapa = vendas
    .flatMap((v) => v.venda_itens)
    .reduce((m, i) => {
      const r = m.get(i.produto_id) ?? { nome: i.produtos.nome, qtd: 0, combos: 0, valor: 0 };
      r.qtd += i.quantidade;
      r.combos += Number(i.valor_combo) * i.quantidade;
      r.valor += Number(i.preco) * i.quantidade;
      return m.set(i.produto_id, r);
    }, new Map<number, { nome: string; qtd: number; combos: number; valor: number }>());
  const linhas = [...mapa.entries()]
    .filter(([id]) => !produto || id === produto)
    .sort((a, b) => (restrito ? b[1].qtd - a[1].qtd : b[1].valor - a[1].valor));
  const corta = <T,>(xs: T[]) => (restrito ? xs.slice(0, 3) : xs); // sem a coluna Valor (faturamento)

  return (
    <>
      <Field label="Produto" className="mb-4 lg:max-w-xs">
        <Select value={produto} onChange={(e) => setProduto(Number(e.target.value))}>
          <option value={0}>Todos</option>
          {[...mapa.entries()]
            .sort((a, b) => a[1].nome.localeCompare(b[1].nome))
            .map(([id, r]) => (
              <option key={id} value={id}>
                {r.nome}
              </option>
            ))}
        </Select>
      </Field>
      {linhas.length === 0 ? (
        <Empty>Nenhum produto vendido no período.</Empty>
      ) : (
        <Tabela
          head={corta(["Produto", "Qtd", "Combos", "Valor"])}
          rows={linhas.map(([, r]) => corta([r.nome, num(r.qtd), num(r.combos, 2), money(r.valor, idioma)]))}
          foot={corta([
            "Total",
            num(linhas.reduce((s, [, r]) => s + r.qtd, 0)),
            num(
              linhas.reduce((s, [, r]) => s + r.combos, 0),
              2,
            ),
            money(
              linhas.reduce((s, [, r]) => s + r.valor, 0),
              idioma,
            ),
          ])}
        />
      )}
    </>
  );
}

// montado só com venda aberta (key = venda): estado de edição começa limpo
function Ticket({
  venda,
  onClose,
  onChange,
  onEditar,
}: {
  venda: Venda;
  onClose: () => void;
  onChange: () => void;
  onEditar: () => void;
}) {
  const { profile, lojaId, idioma } = useApp();
  const [membros, setMembros] = useState<{ id: string; nome: string }[]>([]);
  const [novo, setNovo] = useState(venda.vendedor_id);
  const [anulando, setAnulando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const chefe = profile.role >= 90;
  const podeEditar = chefe && !venda.anulada;

  useEffect(() => {
    if (!podeEditar) return;
    supabase
      .from("loja_membros")
      .select("profiles!inner(id, nome)")
      .eq("loja_id", lojaId!)
      .eq("ativo", true)
      .eq("profiles.ativo", true)
      .then(({ data }) =>
        setMembros(
          ((data ?? []) as unknown as { profiles: { id: string; nome: string } }[])
            .map((m) => m.profiles)
            .sort((a, b) => a.nome.localeCompare(b.nome)),
        ),
      );
  }, [podeEditar, lojaId]);

  async function trocarVendedor() {
    const { error } = await supabase.rpc("trocar_vendedor", { p_venda_id: venda.id, p_vendedor_id: novo });
    if (error) return toast.error(error.message);
    toast.success("Vendedor alterado");
    onClose();
    onChange();
  }

  // Chefe+ anula direto; vendedor precisa do usuário e senha do chefe (anularComChefe)
  async function anular(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const m = campoTexto(String(f.get("motivo") ?? ""), "Motivo", { obrigatorio: true, max: MAX_MOTIVO });
    if (m.erro) return toast.error(m.erro);
    setEnviando(true);
    const error = chefe
      ? (await supabase.rpc("anular_venda", { p_venda_id: venda.id, p_motivo: m.valor })).error?.message
      : (await anularComChefe(venda.id, m.valor!, String(f.get("usuario") ?? ""), String(f.get("senha") ?? "")))
          .error;
    setEnviando(false);
    if (error) return toast.error("Venda não anulada", { description: error });
    toast.success(`Venda #${nVenda(venda.id)} anulada`, { description: "Produtos devolvidos ao estoque" });
    onClose();
    onChange();
  }

  return (
    <Modal open onClose={onClose} title={`Venda #${nVenda(venda.id)}`}>
      {
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-dashed border-line bg-paper/60 p-5 text-sm">
            <Image src="/icon-ticket.png" alt="GamParfum" width={139} height={135} className="mx-auto mb-3 w-14" />
            <div className="text-center text-xs text-muted">
              {dataHora(venda.created_at)} · operador {venda.operador?.nome ?? "—"}
            </div>
            <div className="mt-1 text-center font-semibold">Vendedor: {venda.vendedor.nome}</div>
            {venda.anulada && (
              <div className="mt-2 flex flex-col items-center gap-1 text-center">
                <Badge tone="danger">VENDA ANULADA</Badge>
                {venda.anulacao?.motivo && <p className="text-sm">Motivo: {venda.anulacao.motivo}</p>}
                {venda.anulacao?.por && (
                  <p className="text-xs text-muted">
                    autorizada por {venda.anulacao.por} · {dataHora(venda.anulacao.em)}
                  </p>
                )}
              </div>
            )}
            <ul className="mt-4 space-y-1.5 border-t border-dashed border-line pt-3">
              {venda.venda_itens.map((i, k) => (
                <li key={k} className="grid grid-cols-[1fr_auto_auto] gap-3">
                  <span>{i.produtos.nome}</span>
                  <span className="num text-muted">
                    {i.quantidade} × {money(i.preco, idioma)}
                  </span>
                  <span className="num font-semibold">{money(i.preco * i.quantidade, idioma)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between border-t border-dashed border-line pt-3 font-display text-xl font-bold">
              <span>Total</span>
              <span className="num">{money(venda.total, idioma)}</span>
            </div>
            <ul className="mt-2 space-y-1 text-muted">
              {venda.venda_pagamentos.map((p, k) => (
                <li key={k} className="flex justify-between">
                  <span>
                    {FORMAS[p.forma]}
                    {p.comentario && ` · ${p.comentario}`}
                  </span>
                  <span className="num">{money(p.valor, idioma)}</span>
                </li>
              ))}
              {Number(venda.troco) > 0 && (
                <li className="flex justify-between">
                  <span>Troco entregue</span>
                  <span className="num">{money(venda.troco, idioma)}</span>
                </li>
              )}
              {Number(venda.devolvido) > 0 && (
                <li className="flex justify-between font-semibold text-danger">
                  <span>Devolvido ao cliente</span>
                  <span className="num">−{money(venda.devolvido, idioma)}</span>
                </li>
              )}
            </ul>
          </div>

          {podeEditar && (
            <div className="flex flex-col gap-3 border-t border-line pt-5">
              <Button variant="outline" onClick={onEditar}>
                <Pencil size={16} /> Editar produtos e pagamento
              </Button>
              <div className="flex items-end gap-2">
                <Field label="Trocar vendedor" className="flex-1">
                  <Select value={novo} onChange={(e) => setNovo(e.target.value)}>
                    {!membros.some((m) => m.id === venda.vendedor_id) && (
                      <option value={venda.vendedor_id} disabled>
                        {venda.vendedor.nome} (inativo)
                      </option>
                    )}
                    {membros.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button size="lg" disabled={!novo || novo === venda.vendedor_id} onClick={trocarVendedor}>
                  Salvar
                </Button>
              </div>
            </div>
          )}

          {!venda.anulada &&
            (anulando ? (
              <form
                onSubmit={anular}
                className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger-soft/40 p-4"
              >
                <Field label="Motivo da anulação">
                  <Textarea name="motivo" required minLength={3} maxLength={MAX_MOTIVO} autoFocus />
                </Field>
                {!chefe && (
                  <>
                    <p className="text-xs font-semibold text-muted">Autorização do chefe de loja</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Usuário do chefe">
                        <Input name="usuario" required autoComplete="off" autoCapitalize="none" spellCheck={false} />
                      </Field>
                      <Field label="Senha">
                        {/* new-password: o navegador não preenche com a senha do vendedor logado */}
                        <Input name="senha" type="password" required autoComplete="new-password" />
                      </Field>
                    </div>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setAnulando(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="danger" disabled={enviando}>
                    <Ban size={16} /> Anular — o estoque volta
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Button variant="danger" size="lg" onClick={() => setAnulando(true)}>
                  <Ban size={18} /> Anular venda
                </Button>
                <p className="text-center text-xs text-muted">
                  Os produtos voltam ao estoque.
                  {!chefe && " Precisa do usuário e da senha do chefe de loja."}
                </p>
              </div>
            ))}
        </div>
      }
    </Modal>
  );
}

type ItemEd = { produto_id: number; preco: string; quantidade: string };
type ProdutoEd = { id: number; nome: string; preco: number; ativo: boolean };

// Corrige produtos, quantidades, preços e pagamento; o estoque acompanha (é derivado de venda_itens)
function EditarVenda({ venda, onClose, onSaved }: { venda: Venda; onClose: () => void; onSaved: () => void }) {
  const { lojaId, idioma } = useApp();
  const [produtos, setProdutos] = useState<ProdutoEd[] | null>(null);
  const [itens, setItens] = useState<ItemEd[]>(() =>
    venda.venda_itens.map((i) => ({
      produto_id: i.produto_id,
      preco: String(i.preco),
      quantidade: String(i.quantidade),
    })),
  );
  const [pagando, setPagando] = useState(false);

  useEffect(() => {
    supabase
      .from("produtos")
      .select("id, nome, preco, ativo")
      .eq("loja_id", lojaId!)
      .order("nome")
      .then(({ data }) => setProdutos((data ?? []) as ProdutoEd[]));
  }, [lojaId]);

  // inativos só aparecem se já estavam na venda
  const opcoes = (produtos ?? []).filter((p) => p.ativo || venda.venda_itens.some((i) => i.produto_id === p.id));
  const set = (k: number, patch: Partial<ItemEd>) =>
    setItens((is) => is.map((i, j) => (j === k ? { ...i, ...patch } : i)));
  const validos = itens.map((i) => ({
    produto_id: i.produto_id,
    preco: Number(i.preco.replace(",", ".")),
    quantidade: Number(i.quantidade),
  }));
  const ok =
    validos.length > 0 && validos.every((i) => Number.isInteger(i.quantidade) && i.quantidade > 0 && i.preco >= 0);
  const total = validos.reduce((s, i) => s + i.preco * i.quantidade, 0);

  if (pagando)
    return (
      <Pagamento
        open
        onClose={() => setPagando(false)}
        total={total}
        rotulo="Salvar alterações"
        inicial={venda.venda_pagamentos.map((p) => ({
          forma: p.forma,
          valor: Number(p.valor),
          comentario: p.comentario ?? "",
        }))}
        enviar={async (pagamentos) => {
          const { error } = await supabase.rpc("editar_venda", {
            p_venda_id: venda.id,
            p_itens: validos,
            p_pagamentos: pagamentos,
          });
          if (error) return toast.error("Venda não alterada", { description: error.message });
          toast.success(`Venda #${nVenda(venda.id)} alterada`, { description: "Estoque atualizado" });
          onSaved();
        }}
      />
    );

  return (
    <Modal open onClose={onClose} title={`Editar venda #${nVenda(venda.id)}`}>
      {!produtos ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            {itens.map((i, k) => (
              <li key={k} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-xl border border-line p-3">
                <Field label="Produto">
                  <Select
                    value={i.produto_id}
                    onChange={(e) => {
                      const p = opcoes.find((x) => x.id === Number(e.target.value))!;
                      set(k, { produto_id: p.id, preco: String(p.preco) });
                    }}
                  >
                    {opcoes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="ghost"
                  size="lg"
                  aria-label="Remover produto"
                  onClick={() => setItens(itens.filter((_, j) => j !== k))}
                >
                  <X size={16} />
                </Button>
                <div className="col-span-2 grid grid-cols-2 gap-2">
                  <Field label="Quantidade">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={i.quantidade}
                      onChange={(e) => set(k, { quantidade: e.target.value })}
                    />
                  </Field>
                  <Field label="Preço unitário">
                    <Input
                      inputMode="decimal"
                      value={i.preco}
                      onChange={(e) => set(k, { preco: e.target.value })}
                      className="num"
                    />
                  </Field>
                </div>
              </li>
            ))}
          </ul>
          <Select
            aria-label="Adicionar produto"
            value=""
            onChange={(e) => {
              const p = opcoes.find((x) => x.id === Number(e.target.value));
              if (p) setItens([...itens, { produto_id: p.id, preco: String(p.preco), quantidade: "1" }]);
            }}
          >
            <option value="">+ Adicionar produto…</option>
            {opcoes
              .filter((p) => p.ativo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </Select>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Total anterior {money(venda.total, idioma)}</span>
            <span className="num font-display text-3xl font-bold">{money(total, idioma)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="gold" size="lg" disabled={!ok} onClick={() => setPagando(true)}>
              Continuar para pagamento
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Fechamento do dia: caixa (vendas − devoluções + recuperados) e estoque (entradas e saídas), para conferir no fim do dia.
// Um dia só: vendedor/chefe veem os valores só de hoje (relatorio_vendas/relatorio_caixa liberam só hoje).
function Fechamento({
  vendas,
  caixa,
  dia,
  onChange,
}: {
  vendas: Venda[];
  caixa: Caixa;
  dia: string;
  onChange: () => void;
}) {
  const { lojaId, lojas, idioma, profile } = useApp();
  const loja = lojas.find((l) => l.id === lojaId)?.nome ?? "";
  const dataBR = dia.split("-").reverse().join("/");
  const [desfazendo, setDesfazendo] = useState<Devolucao | null>(null);

  const buscar = useCallback(async () => {
    try {
      return await movimentosDoDia(lojaId!, dia);
    } catch (e) {
      toast.error("Erro ao carregar o estoque do dia", { description: (e as Error).message });
      return [];
    }
  }, [lojaId, dia]);
  const [movs] = useData(buscar);

  const validas = vendas.filter((v) => !v.anulada);
  // ponytail: anulada aparece no dia da venda; anular hoje uma venda de ontem não entra no fechamento de hoje
  const anuladas = vendas.filter((v) => v.anulada);
  const motivo = (v: Venda) =>
    `${v.anulacao?.motivo ?? "sem motivo (sistema antigo)"}${v.anulacao?.por ? ` · autorizada por ${v.anulacao.por}` : ""}`;
  const porProduto = [
    ...validas
      .flatMap((v) => v.venda_itens)
      .reduce((m, i) => {
        const r = m.get(i.produto_id) ?? { nome: i.produtos.nome, qtd: 0, valor: 0 };
        r.qtd += i.quantidade;
        r.valor += Number(i.preco) * i.quantidade;
        return m.set(i.produto_id, r);
      }, new Map<number, { nome: string; qtd: number; valor: number }>())
      .values(),
  ].sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));
  const itens = porProduto.reduce((s, r) => s + r.qtd, 0);
  const total = validas.reduce((s, v) => s + Number(v.total), 0);

  const devolucoes = caixa.devolucoes;
  const devolvidas = devolucoes.filter(conta);
  const recebidos = caixa.recuperacoes.filter((r) => r.tipo === "valor");
  const totalDev = devolvidas.reduce((s, d) => s + Number(d.valor), 0);
  const totalRec = recebidos.reduce((s, r) => s + Number(r.valor), 0);
  // o que deve estar no caixa por forma: vendas − devolvido + recuperado
  const porForma = (f: number) =>
    validas.reduce(
      (s, v) => s + v.venda_pagamentos.filter((p) => p.forma === f).reduce((a, p) => a + Number(p.valor), 0),
      0,
    ) -
    devolvidas.filter((d) => d.forma === f).reduce((s, d) => s + Number(d.valor), 0) +
    recebidos.filter((r) => r.forma === f).reduce((s, r) => s + Number(r.valor), 0);

  const estoque = porTipoEProduto(movs ?? []);
  const soma = (sinal: 1 | -1) =>
    estoque.filter((r) => TIPO_MOV[r.tipo].sinal === sinal).reduce((s, r) => s + r.qtd, 0);
  const desfeitos = (movs ?? []).filter((a) => !a.quantidade).length;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">{profile.role === 50 ? "Suas vendas" : "Caixa"}</h2>
          <Exportar
            arquivo={`fechamento-caixa-${dia}`}
            titulo={`Fechamento de caixa — ${loja}`}
            subtitulo={`Dia ${dataBR} · ${validas.length} vendas · ${itens} itens · vendido ${money(total, idioma)} · devolvido ${money(totalDev, idioma)} · recuperado ${money(totalRec, idioma)}`}
            colunas={[
              { titulo: "Produto / lançamento", largura: 44 },
              { titulo: "Qtd", tipo: "int" },
              { titulo: "Valor", largura: 14 },
            ]}
            linhas={[
              ...porProduto.map((r) => [r.nome, r.qtd, money(r.valor, idioma)]),
              ["TOTAL VENDIDO", itens, money(total, idioma)],
              ...devolucoes.map((d) => [
                `${d.desfeita ? "(DESFEITA) " : ""}DEVOLUÇÃO venda #${nVenda(d.venda_id)} — ${d.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(", ")} — ${d.motivo}`,
                d.itens.reduce((s, i) => s + i.quantidade, 0),
                d.devolve_valor ? `−${money(d.valor, idioma)} (${FORMAS[d.forma!]})` : "sem valor",
              ]),
              ...recebidos.map((r) => [
                `RECUPERADO${r.produto ? ` — ${r.quantidade}× ${r.produto}` : ""}${r.pessoa ? ` (${r.pessoa})` : ""}`,
                r.quantidade,
                `+${money(r.valor, idioma)} (${FORMAS[r.forma!]})`,
              ]),
              ...[1, 2, 3, 4, 5].map((f) => [`NO CAIXA — ${FORMAS[f]}`, null, money(porForma(f), idioma)]),
              ...anuladas.map((v) => [
                `ANULADA #${nVenda(v.id)} (${v.vendedor.nome}) — ${motivo(v)}`,
                null,
                money(v.total, idioma),
              ]),
            ]}
          />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Stat
            label="Vendas"
            value={String(validas.length)}
            hint={anuladas.length ? `${anuladas.length} anulada(s) fora da conta` : undefined}
          />
          <Stat label="Itens vendidos" value={num(itens)} />
          <Stat label="Total vendido" value={money(total, idioma)} />
          <Stat label="Dinheiro em caixa" value={money(porForma(2), idioma)} hint="já com devoluções e recuperados" />
        </div>
        {(totalDev > 0 || totalRec > 0) && (
          <p className="num mb-3 rounded-xl bg-paper px-4 py-2.5 text-sm">
            Vendido {money(total, idioma)}
            {totalDev > 0 && <span className="text-danger"> − devolvido {money(totalDev, idioma)}</span>}
            {totalRec > 0 && <span className="text-ok"> + recuperado {money(totalRec, idioma)}</span>} ={" "}
            <b>{money(total - totalDev + totalRec, idioma)}</b>
          </p>
        )}
        <div className="mb-4 grid grid-cols-2 gap-3">
          {[1, 3, 4, 5].map((f) => (
            <Stat key={f} label={FORMAS[f]} value={money(porForma(f), idioma)} />
          ))}
        </div>
        {porProduto.length === 0 ? (
          <Empty>Nenhuma venda neste dia.</Empty>
        ) : (
          <Tabela
            head={["Produto", "Qtd", "Valor"]}
            rows={porProduto.map((r) => [r.nome, num(r.qtd), money(r.valor, idioma)])}
            foot={["Total", num(itens), money(total, idioma)]}
          />
        )}

        {devolucoes.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Devoluções</h3>
            <Card className="divide-y divide-line">
              {devolucoes.map((d) => (
                <div key={d.id} className={cx("px-4 py-2.5 text-sm", d.desfeita && "opacity-55")}>
                  <div className="flex items-start justify-between gap-3">
                    <span className={cx("font-semibold", d.desfeita && "line-through")}>
                      Venda <span className="num">#{nVenda(d.venda_id)}</span> · {d.vendedor}
                    </span>
                    <span className="num shrink-0 font-semibold text-danger">
                      {d.devolve_valor ? `−${money(d.valor, idioma)}` : "sem valor"}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {hora(d.created_at)} · {d.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(", ")} · por{" "}
                    {d.por ?? "—"}
                    {d.devolve_valor && d.forma && ` · ${FORMAS[d.forma]}`}
                    {!d.volta_estoque && " · produto NÃO voltou ao estoque"}
                  </div>
                  <div className="mt-0.5 text-xs">{d.desfeita ? "Desfeita pela administração" : d.motivo}</div>
                  {profile.role >= 100 && !d.desfeita && (
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => setDesfazendo(d)}>
                      <Undo2 size={14} /> Desfazer devolução
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          </>
        )}

        {caixa.recuperacoes.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Recuperados</h3>
            <Card className="divide-y divide-line">
              {caixa.recuperacoes.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {r.tipo === "valor" ? "Valor cobrado" : r.tipo === "produto" ? "Produto voltou" : "Diferença aceita"}
                      {r.produto && ` · ${r.quantidade}× ${r.produto}`}
                    </span>
                    <span className="block text-xs text-muted">
                      {hora(r.created_at)}
                      {r.pessoa && ` · ${r.pessoa}`}
                      {r.forma && ` · ${FORMAS[r.forma]}`}
                    </span>
                  </span>
                  {r.tipo === "valor" && (
                    <span className="num shrink-0 font-semibold text-ok">+{money(r.valor, idioma)}</span>
                  )}
                </div>
              ))}
            </Card>
          </>
        )}

        {anuladas.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Vendas anuladas</h3>
            <Card className="divide-y divide-line">
              {anuladas.map((v) => (
                <div key={v.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold">
                      <span className="num">#{nVenda(v.id)}</span> · {v.vendedor.nome}
                    </span>
                    <span className="num font-semibold text-danger line-through">{money(v.total, idioma)}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {hora(v.created_at)} · {v.venda_itens.map((i) => `${i.quantidade}× ${i.produtos.nome}`).join(", ")}
                  </div>
                  <div className="mt-0.5 text-xs">{motivo(v)}</div>
                </div>
              ))}
            </Card>
          </>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">Estoque do dia</h2>
          <Exportar
            arquivo={`fechamento-estoque-${dia}`}
            titulo={`Entradas e saídas de estoque — ${loja}`}
            subtitulo={`Dia ${dataBR} · saíram ${soma(-1)} · entraram ${soma(1)} (vendas à parte)`}
            paisagem
            colunas={[
              { titulo: "Data", tipo: "data" },
              { titulo: "Tipo", largura: 14 },
              { titulo: "Perfume", largura: 32 },
              { titulo: "Qtd", tipo: "dif" },
              { titulo: "Por", largura: 20 },
              { titulo: "Comentário", largura: 26 },
              { titulo: "Alterado por", largura: 20 },
            ]}
            linhas={(movs ?? []).map((a) => [
              a.created_at,
              TIPO_MOV[a.tipo!]?.nome ?? a.tipo!,
              a.produtos.nome,
              (TIPO_MOV[a.tipo!]?.sinal ?? 1) * a.quantidade,
              a.abriu?.nome ?? "",
              a.comentario,
              a.editou?.nome ?? "",
            ])}
          />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Stat label="Saídas" value={num(soma(-1))} hint="amostra, doação, estragou" />
          <Stat
            label="Entradas"
            value={num(soma(1))}
            hint={desfeitos ? `${desfeitos} lançamento(s) desfeito(s)` : "compra, devolução, recuperado"}
          />
        </div>
        {!movs ? (
          <div className="grid place-items-center py-10 text-muted">
            <LoaderCircle className="animate-spin" />
          </div>
        ) : movs.length === 0 ? (
          <Empty>Nenhuma entrada ou saída de estoque neste dia (fora as vendas).</Empty>
        ) : (
          <>
            <Tabela
              head={["Tipo", "Perfume", "Qtd"]}
              rows={estoque.map((r) => [
                TIPO_MOV[r.tipo].nome,
                r.nome,
                `${TIPO_MOV[r.tipo].sinal > 0 ? "+" : "−"}${num(r.qtd)}`,
              ])}
            />
            <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Quem lançou</h3>
            <Card className="divide-y divide-line">
              {movs.map((a) => (
                <div
                  key={a.id}
                  className={cx("flex items-start gap-3 px-4 py-2.5 text-sm", !a.quantidade && "opacity-55")}
                >
                  <span className="num w-11 shrink-0 text-xs font-semibold text-muted">{hora(a.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{a.produtos.nome}</div>
                    <div className="text-xs text-muted">
                      {TIPO_MOV[a.tipo!]?.nome} · {a.abriu?.nome ?? "—"}
                      {a.editado_em && ` · alterado por ${a.editou?.nome ?? "—"}`}
                    </div>
                  </div>
                  {a.quantidade ? (
                    <Badge tone={TIPO_MOV[a.tipo!]?.sinal > 0 ? "ok" : "gold"}>
                      {TIPO_MOV[a.tipo!]?.sinal > 0 ? "+" : "−"}
                      {a.quantidade}
                    </Badge>
                  ) : (
                    <Badge tone="danger">desfeito</Badge>
                  )}
                </div>
              ))}
            </Card>
          </>
        )}
      </section>

      {desfazendo && (
        <Justificar
          titulo="Desfazer devolução"
          botao="Desfazer"
          aviso={`Venda #${nVenda(desfazendo.venda_id)}: ${desfazendo.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(", ")}. O estoque e o caixa voltam como antes da devolução.`}
          onClose={() => setDesfazendo(null)}
          onConfirmar={async (m) => {
            const { error } = await supabase.rpc("desfazer_devolucao", { p_id: desfazendo.id, p_motivo: m });
            if (error) {
              toast.error("Não desfeita", { description: error.message });
              return false;
            }
            toast.success("Devolução desfeita");
            onChange();
            return true;
          }}
        />
      )}
    </div>
  );
}
