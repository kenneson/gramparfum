"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bookmark,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import { money, num, type Estoque, type Produto } from "@/lib/domain";
import { MAX_NOME, MAX_TEXTO, campoTexto, validar } from "@/lib/texto";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Textarea,
  cx,
} from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";
import { Pagamento } from "./pagamento";

type Vendedor = { id: string; nome: string };
type Pedido = { id: number; nome: string | null; descricao: string | null };
type Item = {
  id: number;
  produto_id: number;
  preco: number;
  quantidade: number;
  produtos: { nome: string };
};

const supabase = createClient();
const mapaEstoque = (e: Estoque[] | null) =>
  new Map((e ?? []).map((r) => [r.produto_id, r.estoque]));

export function Caixa() {
  const { profile, lojaId, t } = useApp();
  const [escolhido, setEscolhido] = useState<string | null>(null);

  // Vendedores, produtos e estoque da loja (a tela é remontada ao trocar de loja)
  const buscarLoja = useCallback(async () => {
    if (!lojaId) return null;
    const [m, p, e] = await Promise.all([
      supabase
        .from("loja_membros")
        .select("profiles!inner(id, nome, ativo)")
        .eq("loja_id", lojaId)
        .eq("ativo", true)
        .eq("profiles.ativo", true),
      supabase
        .from("produtos")
        .select("*")
        .eq("loja_id", lojaId)
        .eq("ativo", true)
        .eq("a_venda", true)
        .order("nome"),
      supabase.rpc("estoque_loja", { p_loja_id: lojaId }),
    ]);
    let vendedores = ((m.data ?? []) as unknown as { profiles: Vendedor }[])
      .map((r) => r.profiles)
      .sort((a, b) => a.nome.localeCompare(b.nome));
    if (profile.role === 50)
      vendedores = vendedores.filter((v) => v.id === profile.id);
    return {
      vendedores,
      produtos: (p.data ?? []) as Produto[],
      estoque: mapaEstoque(e.data as Estoque[]),
    };
  }, [lojaId, profile]);
  const [loja, recarregarLoja] = useData(buscarLoja);

  if (!lojaId) return <SemLoja />;

  const vendedores = loja?.vendedores ?? [];
  const vendedorId = vendedores.some((v) => v.id === escolhido)
    ? escolhido
    : ((vendedores.find((v) => v.id === profile.id) ?? vendedores[0])?.id ??
      null);

  return (
    <>
      <PageHeader title={t.caixa} />

      {/* Vendedores */}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
        {vendedores.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setEscolhido(v.id)}
            className={cx(
              "flex shrink-0 items-center gap-2.5 rounded-2xl border py-1.5 pr-4 pl-1.5 text-sm font-semibold transition",
              v.id === vendedorId
                ? "border-ink bg-ink text-white shadow-md"
                : "border-line bg-card hover:border-ink/30",
            )}
          >
            <Avatar nome={v.nome} active={v.id === vendedorId} size={34} />
            {v.nome}
          </button>
        ))}
        {loja && vendedores.length === 0 && (
          <p className="text-sm text-muted">
            Nenhum vendedor ativo nesta loja.
          </p>
        )}
      </div>

      {loja && vendedorId && (
        <Venda
          key={vendedorId}
          lojaId={lojaId}
          vendedorId={vendedorId}
          produtos={loja.produtos}
          estoque={loja.estoque}
          estoqueVisivel={profile.role >= 100}
          onVendido={recarregarLoja}
        />
      )}
    </>
  );
}

// Pedidos e carrinho de UM vendedor (key = vendedor: trocar de vendedor zera o estado)
function Venda({
  lojaId,
  vendedorId,
  produtos,
  estoque,
  estoqueVisivel,
  onVendido,
}: {
  lojaId: number;
  vendedorId: string;
  produtos: Produto[];
  estoque: Map<number, number>;
  estoqueVisivel: boolean;
  onVendido: () => void;
}) {
  const { idioma, t } = useApp();
  const [escolhido, setEscolhido] = useState<number | null>(null); // null = carrinho atual
  const [busca, setBusca] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [verCarrinho, setVerCarrinho] = useState(false); // sheet do carrinho no celular

  const buscarPedidos = useCallback(async () => {
    const { data } = await supabase
      .from("pedidos")
      .select("id, nome, descricao")
      .eq("loja_id", lojaId)
      .eq("vendedor_id", vendedorId)
      .order("id");
    return (data ?? []) as Pedido[];
  }, [lojaId, vendedorId]);
  const [pedidosData, recarregarPedidos, setPedidos] = useData(buscarPedidos);
  const pedidos = pedidosData ?? [];

  const pedidoId = pedidos.some((p) => p.id === escolhido && p.nome !== null)
    ? escolhido
    : null;
  const pedidoAtivo =
    pedidoId ?? pedidos.find((p) => p.nome === null)?.id ?? null;

  // Itens marcados com o pedido de origem: durante uma troca de pedido nunca mostramos/editamos itens do anterior
  const buscarItens = useCallback(async () => {
    if (!pedidoAtivo) return { pedido: null, itens: [] as Item[] };
    const { data } = await supabase
      .from("pedido_itens")
      .select("id, produto_id, preco, quantidade, produtos(nome)")
      .eq("pedido_id", pedidoAtivo)
      .order("id");
    return {
      pedido: pedidoAtivo,
      itens: ((data ?? []) as unknown as Item[]).map((i) => ({
        ...i,
        preco: Number(i.preco),
      })),
    };
  }, [pedidoAtivo]);
  const [itensData, recarregarItens, setItensData] = useData(buscarItens);
  const itens = itensData?.pedido === pedidoAtivo ? itensData.itens : [];
  const setItens = (fn: (is: Item[]) => Item[]) =>
    setItensData((d) => d && { ...d, itens: fn(d.itens) });

  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const qtd = itens.reduce((s, i) => s + i.quantidade, 0);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q
      ? produtos.filter((p) =>
          `${p.nome} ${p.descricao ?? ""}`.toLowerCase().includes(q),
        )
      : produtos;
  }, [busca, produtos]);

  async function garantirPedido() {
    if (pedidoAtivo) return pedidoAtivo;
    const { data, error } = await supabase
      .from("pedidos")
      .insert({ loja_id: lojaId, vendedor_id: vendedorId })
      .select("id, nome, descricao")
      .single();
    if (error) throw error;
    setPedidos((ps) => [...(ps ?? []), data as Pedido]);
    return data.id as number;
  }

  async function adicionar(p: Produto) {
    try {
      const id = await garantirPedido();
      const existente = itens.find((i) => i.produto_id === p.id);
      const { error } = existente
        ? await supabase
            .from("pedido_itens")
            .update({ quantidade: existente.quantidade + 1 })
            .eq("id", existente.id)
        : await supabase
            .from("pedido_itens")
            .insert({ pedido_id: id, produto_id: p.id, preco: p.preco });
      if (error) throw error;
      recarregarItens();
    } catch (e) {
      toast.error("Não foi possível adicionar o produto", {
        description: (e as Error).message,
      });
    }
  }

  function clicarProduto(p: Produto) {
    if ((estoque.get(p.id) ?? 0) <= 0) {
      toast.warning(`${p.nome} está com estoque zerado ou negativo`, {
        action: { label: "Adicionar mesmo assim", onClick: () => adicionar(p) },
      });
      return;
    }
    adicionar(p);
  }

  async function editarItem(
    item: Item,
    patch: Partial<Pick<Item, "preco" | "quantidade">>,
  ) {
    setItens((is) =>
      is.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
    );
    const { error } = await supabase
      .from("pedido_itens")
      .update(patch)
      .eq("id", item.id);
    if (error) {
      toast.error("Erro ao atualizar item", { description: error.message });
      recarregarItens();
    }
  }

  async function removerItem(item: Item) {
    setItens((is) => is.filter((i) => i.id !== item.id));
    const { error } = await supabase
      .from("pedido_itens")
      .delete()
      .eq("id", item.id);
    if (error) {
      toast.error("Erro ao remover item", { description: error.message });
      recarregarItens();
    }
  }

  async function salvarPedido(nomeBruto: string, descricaoBruta: string) {
    if (!pedidoAtivo) return;
    const { erro, valores } = validar({
      nome: campoTexto(nomeBruto, "Nome", { obrigatorio: true, max: MAX_NOME }),
      descricao: campoTexto(descricaoBruta, "Descrição"),
    });
    if (erro) return toast.error(erro);
    const { nome, descricao } = valores;
    const { error } = await supabase
      .from("pedidos")
      .update({ nome, descricao })
      .eq("id", pedidoAtivo);
    if (error)
      return toast.error("Erro ao salvar pedido", {
        description: error.message,
      });
    toast.success(`Pedido “${nome}” salvo`);
    setSalvando(false);
    setEscolhido(null);
    recarregarPedidos();
  }

  // Só apaga cliente salvo vazio: os produtos têm de ser removidos antes (o FK apagaria em cascata)
  async function apagarPedido() {
    if (!pedidoSel || itensData?.pedido !== pedidoSel.id) return; // itens ainda carregando
    if (itens.length > 0)
      return toast.warning(
        "Remova os produtos antes de apagar o cliente salvo",
      );
    const { error } = await supabase
      .from("pedidos")
      .delete()
      .eq("id", pedidoSel.id);
    if (error)
      return toast.error("Erro ao apagar cliente salvo", {
        description: error.message,
      });
    toast.success(`“${pedidoSel.nome}” apagado`);
    setEscolhido(null);
    recarregarPedidos();
  }

  function vendaFinalizada(vendaId: number) {
    setCobrando(false);
    toast.success(`Venda nº ${String(vendaId).padStart(6, "0")} registrada`);
    setEscolhido(null);
    recarregarPedidos();
    onVendido(); // atualiza estoque
  }

  const salvos = pedidos.filter((p) => p.nome !== null);
  const pedidoSel = pedidos.find((p) => p.id === pedidoId);

  const listaItens = (
    <>
      {itens.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-sm text-muted">
          <ShoppingBag size={32} className="text-gold" strokeWidth={1.5} />
          {t.vazio}
        </div>
      ) : (
        <ul className="divide-y divide-line lg:max-h-[50dvh] lg:overflow-y-auto lg:overscroll-contain">
          {itens.map((i) => (
            <li key={i.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm leading-snug font-semibold">
                  {i.produtos.nome}
                </span>
                <button
                  type="button"
                  onClick={() => removerItem(i)}
                  aria-label="Remover item"
                  className="-mt-1.5 -mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger active:bg-danger-soft active:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <PrecoInput
                  key={i.preco}
                  valor={i.preco}
                  onCommit={(preco) => editarItem(i, { preco })}
                />
                <div className="flex items-center rounded-xl border border-line">
                  <button
                    type="button"
                    aria-label="Diminuir"
                    disabled={i.quantidade <= 1}
                    onClick={() =>
                      editarItem(i, { quantidade: i.quantidade - 1 })
                    }
                    className="grid size-9 place-items-center rounded-l-xl text-muted hover:text-ink active:bg-ink/5 disabled:opacity-30"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="num w-7 text-center text-sm font-semibold">
                    {i.quantidade}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar"
                    onClick={() =>
                      editarItem(i, { quantidade: i.quantidade + 1 })
                    }
                    className="grid size-9 place-items-center rounded-r-xl text-muted hover:text-ink active:bg-ink/5"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <span className="num ml-auto text-sm font-bold">
                  {money(i.preco * i.quantidade, idioma)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const rodape = (
    <div className="border-t border-line px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">{t.total}</span>
        <span className="num font-display text-4xl font-semibold">
          {money(total, idioma)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
        <Button
          variant="outline"
          size="lg"
          disabled={itens.length === 0 || pedidoId !== null}
          onClick={() => {
            setVerCarrinho(false);
            setSalvando(true);
          }}
          title={t.salvar}
          aria-label={t.salvar}
        >
          <Bookmark size={18} />
        </Button>
        <Button
          variant="gold"
          size="lg"
          disabled={itens.length === 0}
          onClick={() => {
            setVerCarrinho(false);
            setCobrando(true);
          }}
        >
          {t.cobrar}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Pedidos salvos */}
      {salvos.length > 0 && (
        <div className="-mx-4 mb-5 flex items-center gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <Chip active={pedidoId === null} onClick={() => setEscolhido(null)}>
            {t.pedidoAtual}
          </Chip>
          {salvos.map((p) => (
            <Chip
              key={p.id}
              active={pedidoId === p.id}
              onClick={() => setEscolhido(p.id)}
              title={p.descricao ?? ""}
            >
              <Bookmark size={13} /> {p.nome}
            </Chip>
          ))}
          {pedidoSel && (
            <button
              type="button"
              onClick={apagarPedido}
              title={
                itens.length > 0
                  ? "Remova os produtos antes de apagar"
                  : `Apagar “${pedidoSel.nome}”`
              }
              className={cx(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition",
                itens.length > 0
                  ? "text-muted/60"
                  : "text-danger hover:bg-danger-soft active:bg-danger-soft",
              )}
            >
              <Trash2 size={14} /> Apagar
            </button>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Catálogo */}
        <section>
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 mb-3 bg-paper/85 px-4 py-2 backdrop-blur-xl lg:static lg:mx-0 lg:mb-4 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                enterKeyHint="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t.buscar}
                className="h-12 pl-11 shadow-card"
              />
            </div>
          </div>
          {filtrados.length === 0 ? (
            <Empty>Nenhum produto à venda {busca && `para “${busca}”`}.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {filtrados.map((p) => {
                const est = estoque.get(p.id) ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => clicarProduto(p)}
                    className="group flex min-h-32 flex-col rounded-2xl border border-line/80 bg-card p-3.5 text-left shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-lift active:translate-y-0 active:scale-[0.97] active:bg-gold-soft/40 sm:min-h-36 sm:p-4"
                  >
                    <div className="line-clamp-2 text-[15px] leading-snug font-semibold sm:text-base">
                      {p.nome}
                    </div>
                    {p.descricao && (
                      <div className="mt-1 line-clamp-2 text-xs text-muted">
                        {p.descricao}
                      </div>
                    )}
                    <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-3">
                      <span className="num font-display text-[1.375rem] leading-none font-semibold sm:text-2xl">
                        {money(p.preco, idioma)}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {Number(p.valor_combo) > 0 && (
                          <Badge tone="gold">
                            combo {num(p.valor_combo, 2)}
                          </Badge>
                        )}
                        {estoqueVisivel ? (
                          <Badge tone={est <= 0 ? "danger" : "neutral"}>
                            {t.estoque} {est}
                          </Badge>
                        ) : (
                          est <= 0 && <Badge tone="danger">sem estoque</Badge>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Carrinho (desktop) */}
        <Card className="hidden lg:sticky lg:top-22 lg:block">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-display text-2xl font-semibold">
              {pedidoSel?.nome ?? t.detalheVenda}
            </h2>
            {qtd > 0 && <Badge tone="gold">{qtd} itens</Badge>}
          </div>
          {listaItens}
          {rodape}
        </Card>
      </div>

      {/* Celular: barra flutuante abre o carrinho em sheet */}
      {itens.length > 0 && (
        <>
          <div aria-hidden className="h-20 lg:hidden" />
          <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-2 rounded-2xl bg-ink p-2 text-white shadow-lift ring-1 ring-white/10 lg:hidden">
            <button
              type="button"
              onClick={() => setVerCarrinho(true)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1 text-left transition active:bg-white/10"
            >
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-white/10">
                <ShoppingBag size={18} />
                <span className="num absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold-bright px-1 text-[11px] font-bold text-ink">
                  {qtd}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] text-white/60">
                  Ver pedido
                </span>
                <span className="num block truncate font-display text-xl leading-tight font-semibold">
                  {money(total, idioma)}
                </span>
              </span>
            </button>
            <Button
              variant="gold"
              size="lg"
              className="px-5"
              onClick={() => setCobrando(true)}
            >
              {t.cobrar}
            </Button>
          </div>
        </>
      )}
      <Modal
        open={verCarrinho && itens.length > 0}
        onClose={() => setVerCarrinho(false)}
        title={pedidoSel?.nome ?? t.detalheVenda}
      >
        <div className="-m-5 sm:-m-6">
          {listaItens}
          {rodape}
        </div>
      </Modal>

      {/* montado só quando aberto: estado limpo a cada cobrança */}
      {cobrando && pedidoAtivo && (
        <Pagamento
          open
          onClose={() => setCobrando(false)}
          total={total}
          enviar={async (pagamentos) => {
            const { data, error } = await supabase.rpc("finalizar_venda", {
              p_pedido_id: pedidoAtivo,
              p_pagamentos: pagamentos,
            });
            if (error)
              return toast.error("Venda não registrada", {
                description: error.message,
              });
            vendaFinalizada(data as number);
          }}
        />
      )}
      <SalvarPedido
        open={salvando}
        onClose={() => setSalvando(false)}
        onSave={salvarPedido}
      />
    </>
  );
}

function Chip({
  active,
  ...p
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition",
        active
          ? "border-gold bg-gold-soft text-gold-ink"
          : "border-line bg-card text-muted hover:text-ink",
      )}
      {...p}
    />
  );
}

// key={valor} no uso: remonta quando o preço muda no servidor
function PrecoInput({
  valor,
  onCommit,
}: {
  valor: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(String(valor));
  const commit = () => {
    const n = Math.round(Number(v.replace(",", ".")) * 100) / 100;
    if (Number.isFinite(n) && n >= 0 && n !== valor) onCommit(n);
    else setV(String(valor));
  };
  return (
    <input
      inputMode="decimal"
      aria-label="Preço unitário"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="num h-8 w-24 rounded-lg border border-transparent bg-paper px-2 text-sm font-medium transition hover:border-line focus:border-gold focus:bg-card focus:outline-none"
    />
  );
}

function SalvarPedido({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (nome: string, descricao: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Salvar pedido">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onSave(String(f.get("nome") ?? ""), String(f.get("descricao") ?? ""));
        }}
      >
        <p className="text-sm text-muted">
          O pedido fica guardado para este vendedor e pode ser cobrado depois.
        </p>
        <Field label="Nome">
          <Input
            name="nome"
            required
            minLength={3}
            maxLength={MAX_NOME}
            autoFocus
            placeholder="Ex.: Cliente Maria"
          />
        </Field>
        <Field label="Descrição">
          <Textarea name="descricao" maxLength={MAX_TEXTO} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
