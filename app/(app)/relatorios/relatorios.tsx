"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/use-data";
import Image from "next/image";
import { Ban, LoaderCircle, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { FORMAS, dataHora, hojeISO, hora, money, num } from "@/lib/domain";
import { amostrasDoDia, amostrasPorProduto } from "@/lib/amostras";
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
  cx,
} from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";
import { Pagamento } from "../caixa/pagamento";
import { Exportar } from "@/components/exportar";

// Vem de relatorio_vendas. Perfil < 100 em vários dias: total, troco e preco vêm null e só pagamentos em dinheiro.
type Venda = {
  id: number;
  created_at: string;
  total: number;
  troco: number;
  anulada: boolean;
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
const supabase = createClient();
const nVenda = (id: number) => String(id).padStart(6, "0");
const combos = (v: Venda) => v.venda_itens.reduce((s, i) => s + Number(i.valor_combo) * i.quantidade, 0);

export function Relatorios() {
  const { lojaId, t, profile } = useApp();
  const [aba, setAba] = useState<Aba>("detalhado");
  const [d1, setD1] = useState(hojeISO);
  const [d2, setD2] = useState(hojeISO);
  const [aberta, setAberta] = useState<Venda | null>(null);
  const [editando, setEditando] = useState<Venda | null>(null);
  // Faturamento só para a Administração; vendedor/chefe veem o detalhado de um dia por vez (regra também no banco)
  const restrito = profile.role < 100;
  const umDia = aba === "fechamento" || (restrito && aba === "detalhado");
  const ate = umDia ? d1 : d2;

  const chave = `${d1}|${ate}`;
  const buscar = useCallback(async () => {
    if (!lojaId) return null;
    // ponytail: agrega no cliente; agregar no SQL se o volume por período passar de alguns milhares
    const { data, error } = await supabase.rpc("relatorio_vendas", { p_loja_id: lojaId, p_de: d1, p_ate: ate });
    if (error) toast.error("Erro ao carregar vendas", { description: error.message });
    return { chave: `${d1}|${ate}`, vendas: (data ?? []) as Venda[] };
  }, [lojaId, d1, ate]);
  const [data, carregar] = useData(buscar);
  const vendas = data?.chave === chave ? data.vendas : null; // null = carregando o período atual

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

      {vendas === null ? (
        <div className="grid place-items-center py-20 text-muted">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : aba === "detalhado" ? (
        <Detalhado vendas={vendas} onAbrir={setAberta} />
      ) : aba === "fechamento" ? (
        <Fechamento key={d1} vendas={vendas} dia={d1} />
      ) : aba === "combos" ? (
        <Combos vendas={vendas.filter((v) => !v.anulada)} restrito={restrito} />
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
  const porForma = (f: number) =>
    validas.reduce(
      (s, v) => s + v.venda_pagamentos.filter((p) => p.forma === f).reduce((a, p) => a + Number(p.valor), 0),
      0,
    );

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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <Stat label="Dinheiro em caixa" value={money(porForma(2), idioma)} />
        <Stat label="Pix" value={money(porForma(1), idioma)} />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {[3, 4, 5].map((f) => (
          <Badge key={f}>
            {FORMAS[f]}: {money(porForma(f), idioma)}
          </Badge>
        ))}
      </div>

      {lista.length === 0 ? (
        <Empty>Nenhuma venda no período.</Empty>
      ) : (
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
                  </span>
                  <span className="hidden min-w-0 sm:block">
                    <span className="block truncate text-sm font-semibold">{v.vendedor.nome}</span>
                    <span className="flex flex-wrap gap-1 pt-1">
                      {v.venda_pagamentos.map((p, i) => (
                        <Badge key={i}>{FORMAS[p.forma]}</Badge>
                      ))}
                    </span>
                  </span>
                  <span className="num hidden text-right text-sm text-gold-ink sm:block">{num(combos(v), 2)}</span>
                  <span
                    className={cx("num text-right font-display text-xl font-semibold", v.anulada && "line-through")}
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
      )}
    </>
  );
}

function Combos({ vendas, restrito }: { vendas: Venda[]; restrito: boolean }) {
  const { idioma } = useApp();
  const linhas = [
    ...vendas
      .reduce((m, v) => {
        const r = m.get(v.vendedor_id) ?? { nome: v.vendedor.nome, combos: 0, dinheiro: 0, vendas: 0 };
        r.combos += combos(v);
        r.vendas += Number(v.total);
        r.dinheiro += v.venda_pagamentos.filter((p) => p.forma === 2).reduce((s, p) => s + Number(p.valor), 0);
        return m.set(v.vendedor_id, r);
      }, new Map<string, { nome: string; combos: number; dinheiro: number; vendas: number }>())
      .values(),
  ].sort((a, b) => b.combos - a.combos);

  if (linhas.length === 0) return <Empty>Nenhuma venda no período.</Empty>;
  const soma = (k: "combos" | "dinheiro" | "vendas") => linhas.reduce((s, l) => s + l[k], 0);

  const corta = <T,>(xs: T[]) => (restrito ? xs.slice(0, 3) : xs); // sem a coluna Vendas (faturamento)

  return (
    <Tabela
      head={corta(["Vendedor", "Combos", "Dinheiro", "Vendas"])}
      rows={linhas.map((l) => corta([l.nome, num(l.combos, 2), money(l.dinheiro, idioma), money(l.vendas, idioma)]))}
      foot={corta(["Total", num(soma("combos"), 2), money(soma("dinheiro"), idioma), money(soma("vendas"), idioma)])}
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
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const podeEditar = profile.role >= 90 && !venda.anulada;

  useEffect(() => {
    if (!podeEditar) return;
    supabase
      .from("loja_membros")
      .select("profiles!inner(id, nome)")
      .eq("loja_id", lojaId!)
      .then(({ data }) =>
        setMembros(((data ?? []) as unknown as { profiles: { id: string; nome: string } }[]).map((m) => m.profiles)),
      );
  }, [podeEditar, lojaId]);

  async function rpc(fn: "anular_venda" | "trocar_vendedor", args: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(fn, args);
    if (error) return toast.error(error.message);
    toast.success(ok);
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
              <div className="mt-2 flex justify-center">
                <Badge tone="danger">VENDA ANULADA</Badge>
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
            <div className="mt-3 flex justify-between border-t border-dashed border-line pt-3 font-display text-xl font-semibold">
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
                    {membros.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  size="lg"
                  disabled={!novo || novo === venda.vendedor_id}
                  onClick={() =>
                    rpc("trocar_vendedor", { p_venda_id: venda.id, p_vendedor_id: novo }, "Vendedor alterado")
                  }
                >
                  Salvar
                </Button>
              </div>
              <Button
                variant="danger"
                onClick={() =>
                  confirmarAnular
                    ? rpc("anular_venda", { p_venda_id: venda.id }, "Venda anulada")
                    : setConfirmarAnular(true)
                }
              >
                <Ban size={16} /> {confirmarAnular ? "Confirmar anulação — o estoque volta" : "Anular venda"}
              </Button>
            </div>
          )}
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
            <span className="num font-display text-3xl font-semibold">{money(total, idioma)}</span>
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

// Fechamento do dia: vendas e amostras separadas, para conferir caixa e estoque.
// Um dia só: vendedor/chefe também veem os valores do dia (relatorio_vendas libera um dia por vez).
function Fechamento({ vendas, dia }: { vendas: Venda[]; dia: string }) {
  const { lojaId, lojas, idioma, profile } = useApp();
  const loja = lojas.find((l) => l.id === lojaId)?.nome ?? "";
  const dataBR = dia.split("-").reverse().join("/");

  const buscar = useCallback(async () => {
    try {
      return await amostrasDoDia(lojaId!, dia);
    } catch (e) {
      toast.error("Erro ao carregar amostras", { description: (e as Error).message });
      return [];
    }
  }, [lojaId, dia]);
  const [amostras] = useData(buscar);

  const validas = vendas.filter((v) => !v.anulada);
  const anuladas = vendas.length - validas.length;
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
  const porForma = (f: number) =>
    validas.reduce(
      (s, v) => s + v.venda_pagamentos.filter((p) => p.forma === f).reduce((a, p) => a + Number(p.valor), 0),
      0,
    );

  const amostrasProd = amostrasPorProduto(amostras ?? []);
  const abertas = amostrasProd.reduce((s, r) => s + r.qtd, 0);
  const canceladas = (amostras ?? []).filter((a) => !a.quantidade).length;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">{profile.role === 50 ? "Suas vendas" : "Vendas"}</h2>
          <Exportar
            arquivo={`fechamento-vendas-${dia}`}
            titulo={`Fechamento de vendas — ${loja}`}
            subtitulo={`Dia ${dataBR} · ${validas.length} vendas · ${itens} itens · total ${money(total, idioma)}`}
            colunas={[
              { titulo: "Produto", largura: 34 },
              { titulo: "Qtd vendida", tipo: "int" },
              { titulo: "Valor", largura: 14 },
            ]}
            linhas={[
              ...porProduto.map((r) => [r.nome, r.qtd, money(r.valor, idioma)]),
              ["TOTAL", itens, money(total, idioma)],
            ]}
          />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Stat
            label="Vendas"
            value={String(validas.length)}
            hint={anuladas ? `${anuladas} anulada(s) fora da conta` : undefined}
          />
          <Stat label="Itens vendidos" value={num(itens)} />
          <Stat label="Total vendido" value={money(total, idioma)} />
          <Stat label="Dinheiro em caixa" value={money(porForma(2), idioma)} />
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {[1, 3, 4, 5].map((f) => (
            <Badge key={f}>
              {FORMAS[f]}: {money(porForma(f), idioma)}
            </Badge>
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
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">Amostras abertas</h2>
          <Exportar
            arquivo={`fechamento-amostras-${dia}`}
            titulo={`Fechamento de amostras — ${loja}`}
            subtitulo={`Dia ${dataBR} · ${abertas} amostra(s) abertas`}
            paisagem
            colunas={[
              { titulo: "Aberta em", tipo: "data" },
              { titulo: "Perfume", largura: 32 },
              { titulo: "Qtd", tipo: "int" },
              { titulo: "Aberta por", largura: 20 },
              { titulo: "Comentário", largura: 26 },
              { titulo: "Editada por", largura: 20 },
            ]}
            linhas={(amostras ?? []).map((a) => [
              a.created_at,
              a.produtos.nome,
              a.quantidade,
              a.abriu?.nome ?? "",
              a.comentario,
              a.editou?.nome ?? "",
            ])}
          />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Stat label="Amostras abertas" value={num(abertas)} hint="cada uma baixou 1 unidade" />
          <Stat
            label="Perfumes"
            value={num(amostrasProd.length)}
            hint={canceladas ? `${canceladas} cancelada(s)` : undefined}
          />
        </div>
        {!amostras ? (
          <div className="grid place-items-center py-10 text-muted">
            <LoaderCircle className="animate-spin" />
          </div>
        ) : amostras.length === 0 ? (
          <Empty>Nenhuma amostra aberta neste dia.</Empty>
        ) : (
          <>
            <Tabela
              head={["Perfume", "Qtd"]}
              rows={amostrasProd.map((r) => [r.nome, num(r.qtd)])}
              foot={["Total", num(abertas)]}
            />
            <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Quem abriu</h3>
            <Card className="divide-y divide-line">
              {amostras.map((a) => (
                <div
                  key={a.id}
                  className={cx("flex items-start gap-3 px-4 py-2.5 text-sm", !a.quantidade && "opacity-55")}
                >
                  <span className="num w-11 shrink-0 text-xs font-semibold text-muted">{hora(a.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{a.produtos.nome}</div>
                    <div className="text-xs text-muted">
                      {a.abriu?.nome ?? "—"}
                      {a.editado_em && ` · editada por ${a.editou?.nome ?? "—"}`}
                    </div>
                  </div>
                  {a.quantidade ? <Badge tone="gold">−{a.quantidade}</Badge> : <Badge tone="danger">cancelada</Badge>}
                </div>
              ))}
            </Card>
          </>
        )}
      </section>
    </div>
  );
}
