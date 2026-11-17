"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Banknote, CircleCheck, Handshake, LoaderCircle, PackageCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import { FORMAS, dataHora, money, num } from "@/lib/domain";
import { MAX_TEXTO, campoTexto } from "@/lib/texto";
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, Stat, Textarea, cx } from "@/components/ui";
import { avisarPendencias, useApp } from "@/components/shell";
import { Exportar } from "@/components/exportar";
import { Justificar } from "@/components/justificar";

const supabase = createClient();

// Vem de divergencias_loja: contagens que não bateram (diferenca = contado − esperado; < 0 faltou, > 0 sobrou)
// e quantas unidades já foram resolvidas
type Div = {
  movimento_id: number;
  produto_id: number;
  produto: string;
  preco: number;
  contado_em: string;
  contado_por: string | null;
  contado_por_id: string | null;
  esperado: number;
  contado: number;
  diferenca: number;
  resolvido: number;
  explicacao: string | null;
};
const pendenteDe = (d: Div) => Math.max(0, Math.abs(d.diferenca) - d.resolvido);
type TipoRec = "valor" | "produto" | "acerto";
type Rec = {
  id: number;
  created_at: string;
  tipo: TipoRec;
  quantidade: number;
  valor: number;
  forma: number | null;
  comentario: string | null;
  desfeita_em: string | null;
  motivo_desfeita: string | null;
  produtos: { nome: string };
  responsavel: { nome: string } | null;
  por: { nome: string } | null;
};

const TIPOS_REC: Record<TipoRec, { nome: string; ajuda: string; icone: typeof Banknote }> = {
  valor: { nome: "Cobrar o valor", ajuda: "A pessoa paga o produto. Entra no caixa do dia; o estoque não muda.", icone: Banknote },
  produto: { nome: "O produto voltou", ajuda: "O produto apareceu. Volta ao estoque.", icone: PackageCheck },
  acerto: { nome: "Aceitar a diferença", ajuda: "Diferença acertada com a pessoa. Nada muda no caixa nem no estoque.", icone: Handshake },
};

// Administração resolve; chefe de loja (leitura) só vê as contagens pendentes. O banco confere de novo.
export function Recuperados({ onSaved, leitura = false }: { onSaved: () => void; leitura?: boolean }) {
  const { lojaId, lojas, idioma } = useApp();
  const loja = lojas.find((l) => l.id === lojaId)?.nome ?? "";
  const [resolvendo, setResolvendo] = useState<Div | null>(null);
  const [desfazendo, setDesfazendo] = useState<Rec | null>(null);

  const buscar = useCallback(async () => {
    const [d, r] = await Promise.all([
      supabase.rpc("divergencias_loja", { p_loja_id: lojaId! }),
      leitura
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("recuperacoes")
            .select(
              `id, created_at, tipo, quantidade, valor, forma, comentario, desfeita_em, motivo_desfeita, produtos(nome),
               responsavel:profiles!recuperacoes_responsavel_id_fkey(nome), por:profiles!recuperacoes_created_by_fkey(nome)`,
            )
            .eq("loja_id", lojaId!)
            .order("created_at", { ascending: false })
            .limit(300),
    ]);
    if (d.error || r.error)
      toast.error("Erro ao carregar recuperados", { description: (d.error ?? r.error)!.message });
    return { divs: (d.data ?? []) as Div[], recs: (r.data ?? []) as unknown as Rec[] };
  }, [lojaId, leitura]);
  const [data, carregar] = useData(buscar);
  const feito = () => {
    carregar();
    avisarPendencias();
    onSaved();
  };

  if (!data)
    return (
      <div className="grid place-items-center py-20 text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    );

  const pendentes = data.divs.filter((d) => pendenteDe(d) > 0);
  const ativas = data.recs.filter((r) => !r.desfeita_em);
  const recebido = ativas.filter((r) => r.tipo === "valor").reduce((s, r) => s + Number(r.valor), 0);

  if (leitura)
    return (
      <section>
        <h2 className="mb-1 font-display text-2xl font-bold">Contagens que não bateram</h2>
        <p className="mb-3 text-sm text-muted">
          Diferenças entre o que foi contado e o que o sistema esperava, ainda sem resolver. Confira com quem contou; quem
          resolve (cobrar, produto voltou ou aceitar) é a <b className="text-ink">administração</b>.
        </p>
        {pendentes.length === 0 ? (
          <Empty>Nenhuma diferença pendente. As contagens bateram ou já foram resolvidas.</Empty>
        ) : (
          <Card className="divide-y divide-line">
            {pendentes.map((d) => (
              <LinhaPendente key={d.movimento_id} d={d} />
            ))}
          </Card>
        )}
      </section>
    );

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Diferenças pendentes" value={num(pendentes.reduce((s, d) => s + pendenteDe(d), 0))} hint={`${pendentes.length} contagem(ns)`} />
        <Stat label="Valor recuperado" value={money(recebido, idioma)} />
        <Stat label="Produtos que voltaram" value={num(ativas.filter((r) => r.tipo === "produto").reduce((s, r) => s + r.quantidade, 0))} />
        <Stat label="Diferenças aceitas" value={num(ativas.filter((r) => r.tipo === "acerto").reduce((s, r) => s + r.quantidade, 0))} />
      </div>

      <section className="mb-10">
        <h2 className="mb-1 font-display text-2xl font-bold">Contagens que não bateram</h2>
        <p className="mb-3 text-sm text-muted">
          Contou menos ou mais do que o estoque esperado (pelas vendas e lançamentos). Toque em{" "}
          <b className="text-ink">Resolver</b>: na falta, cobre o valor da pessoa, registre que o produto voltou ou aceite;
          na sobra, aceite explicando o motivo (ex.: venda ou compra não lançada).
        </p>
        {pendentes.length === 0 ? (
          <Empty>Nenhuma diferença pendente. As contagens bateram ou já foram resolvidas.</Empty>
        ) : (
          <Card className="divide-y divide-line">
            {pendentes.map((d) => (
              <LinhaPendente key={d.movimento_id} d={d}>
                <Button size="sm" onClick={() => setResolvendo(d)}>
                  Resolver
                </Button>
              </LinhaPendente>
            ))}
          </Card>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">Recuperados</h2>
          <Exportar
            arquivo="recuperados"
            titulo={`Recuperados — ${loja}`}
            subtitulo="Faltas de contagem resolvidas"
            paisagem
            colunas={[
              { titulo: "Data", tipo: "data" },
              { titulo: "Como", largura: 18 },
              { titulo: "Produto", largura: 30 },
              { titulo: "Qtd", tipo: "int" },
              { titulo: "Valor", largura: 14 },
              { titulo: "Forma", largura: 14 },
              { titulo: "Pessoa", largura: 20 },
              { titulo: "Registrado por", largura: 20 },
              { titulo: "Comentário", largura: 30 },
            ]}
            linhas={data.recs.map((r) => [
              r.created_at,
              `${TIPOS_REC[r.tipo].nome}${r.desfeita_em ? " (DESFEITO)" : ""}`,
              r.produtos.nome,
              r.quantidade,
              r.tipo === "valor" ? money(r.valor, idioma) : "",
              r.forma ? FORMAS[r.forma] : "",
              r.responsavel?.nome ?? "",
              r.por?.nome ?? "",
              r.comentario,
            ])}
          />
        </div>
        {data.recs.length === 0 ? (
          <Empty>Nada recuperado ainda.</Empty>
        ) : (
          <Card className="divide-y divide-line">
            {data.recs.map((r) => {
              const T = TIPOS_REC[r.tipo];
              return (
                <div key={r.id} className={cx("flex items-start gap-3 px-4 py-3 sm:px-5", r.desfeita_em && "opacity-55")}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ok-soft text-ok">
                    <T.icone size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={cx("truncate text-sm font-semibold", r.desfeita_em && "line-through")}>
                      {r.quantidade}× {r.produtos.nome}
                    </div>
                    <div className="text-xs text-muted">
                      {T.nome}
                      {r.responsavel && ` · ${r.responsavel.nome}`} · por {r.por?.nome ?? "—"} · {dataHora(r.created_at)}
                      {r.comentario && ` · ${r.comentario}`}
                    </div>
                    {r.desfeita_em ? (
                      <div className="text-[11px] text-danger">
                        desfeito em {dataHora(r.desfeita_em)} · “{r.motivo_desfeita}”
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => setDesfazendo(r)}>
                        <Undo2 size={14} /> Desfazer
                      </Button>
                    )}
                  </div>
                  {r.tipo === "valor" && (
                    <span className="num shrink-0 text-right font-bold">
                      {money(r.valor, idioma)}
                      <span className="block text-[11px] font-normal text-muted">{FORMAS[r.forma!]}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {resolvendo && (
        <Resolver
          key={resolvendo.movimento_id}
          div={resolvendo}
          onClose={() => setResolvendo(null)}
          onSaved={() => {
            setResolvendo(null);
            feito();
          }}
        />
      )}
      {desfazendo && (
        <Justificar
          titulo="Desfazer recuperação"
          botao="Desfazer"
          aviso={`${desfazendo.quantidade}× ${desfazendo.produtos.nome} (${TIPOS_REC[desfazendo.tipo].nome.toLowerCase()}) volta a ser falta pendente${desfazendo.tipo === "produto" ? " e sai do estoque" : ""}.`}
          onClose={() => setDesfazendo(null)}
          onConfirmar={async (motivo) => {
            const { error } = await supabase.rpc("desfazer_recuperacao", { p_id: desfazendo.id, p_motivo: motivo });
            if (error) {
              toast.error("Não desfeito", { description: error.message });
              return false;
            }
            toast.success("Recuperação desfeita");
            feito();
            return true;
          }}
        />
      )}
    </>
  );
}

function LinhaPendente({ d, children }: { d: Div; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{d.produto}</div>
        <div className="text-xs text-muted">
          Contagem de {dataHora(d.contado_em)} por {d.contado_por ?? "—"} · esperado {d.esperado}, contado {d.contado}
          {d.resolvido > 0 && ` · ${d.resolvido} já resolvido(s)`}
        </div>
        {d.explicacao && <div className="mt-0.5 text-xs">Explicação: “{d.explicacao}”</div>}
      </div>
      <Badge tone="danger">
        {d.diferenca < 0 ? "faltam" : "sobram"} {pendenteDe(d)}
      </Badge>
      {children}
    </div>
  );
}

function Resolver({ div, onClose, onSaved }: { div: Div; onClose: () => void; onSaved: () => void }) {
  const { lojaId, idioma } = useApp();
  const pendente = pendenteDe(div);
  const sobra = div.diferenca > 0; // sobra só se resolve aceitando a diferença (regra também no banco)
  const [tipo, setTipo] = useState<TipoRec>(sobra ? "acerto" : "valor");
  const [qtd, setQtd] = useState(String(pendente));
  const [valor, setValor] = useState(String(Number(div.preco) * pendente));
  const [forma, setForma] = useState(2);
  const [pessoa, setPessoa] = useState(div.contado_por_id ?? "");
  const [comentario, setComentario] = useState("");
  const [membros, setMembros] = useState<{ id: string; nome: string }[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    supabase
      .from("loja_membros")
      .select("profiles!inner(id, nome)")
      .eq("loja_id", lojaId!)
      .then(({ data }) =>
        setMembros(
          ((data ?? []) as unknown as { profiles: { id: string; nome: string } }[])
            .map((m) => m.profiles)
            .sort((a, b) => a.nome.localeCompare(b.nome)),
        ),
      );
  }, [lojaId]);

  const n = Number(qtd);
  const v = Number(valor.replace(",", "."));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(n) || n < 1 || n > pendente) return toast.error(`Quantidade: de 1 a ${pendente}`);
    if (tipo === "valor" && !(v > 0)) return toast.error("Informe o valor recebido");
    if (tipo !== "produto" && !sobra && !pessoa) return toast.error("Escolha a pessoa");
    const com = campoTexto(comentario, "Comentário", { obrigatorio: tipo === "acerto" });
    if (com.erro) return toast.error(com.erro);
    setEnviando(true);
    const { error } = await supabase.rpc("registrar_recuperacao", {
      p_movimento_id: div.movimento_id,
      p_tipo: tipo,
      p_quantidade: n,
      p_valor: tipo === "valor" ? v : null,
      p_forma: tipo === "valor" ? forma : null,
      p_responsavel: pessoa || null,
      p_comentario: com.valor,
    });
    setEnviando(false);
    if (error) return toast.error("Não registrado", { description: error.message });
    toast.success(
      tipo === "valor"
        ? `${money(v, idioma)} recuperado`
        : tipo === "produto"
          ? `${n} un. de volta ao estoque`
          : "Diferença aceita",
    );
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Resolver falta">
      <form className="flex flex-col gap-4" onSubmit={enviar}>
        <div className="rounded-xl bg-paper px-4 py-3 text-sm">
          <div className="font-semibold">{div.produto}</div>
          <div className="text-xs text-muted">
            Contagem de {dataHora(div.contado_em)} por {div.contado_por ?? "—"}: esperado {div.esperado}, contado{" "}
            {div.contado} → {sobra ? "sobram" : "faltam"} {pendente} · preço {money(div.preco, idioma)}
          </div>
          {div.explicacao && <div className="mt-1 text-xs">Explicação de quem contou: “{div.explicacao}”</div>}
        </div>
        {sobra && (
          <p className="text-sm text-muted">
            Contou <b className="text-ink">mais</b> do que o sistema esperava. Explique o motivo (ex.: venda feita e não
            lançada no caixa, compra não lançada) e aceite a diferença.
          </p>
        )}

        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Como resolver">
          {(Object.keys(TIPOS_REC) as TipoRec[])
            .filter((t) => !sobra || t === "acerto")
            .map((t) => {
            const T = TIPOS_REC[t];
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tipo === t}
                onClick={() => setTipo(t)}
                className={cx(
                  "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
                  tipo === t ? "border-ink bg-ink text-white" : "border-line bg-card hover:border-ink/30",
                )}
              >
                <T.icone size={18} className={cx("mt-0.5 shrink-0", tipo === t ? "text-gold-bright" : "text-muted")} />
                <span>
                  <span className="block text-sm font-semibold">{T.nome}</span>
                  <span className={cx("block text-xs", tipo === t ? "text-white/70" : "text-muted")}>{T.ajuda}</span>
                </span>
                {tipo === t && <CircleCheck size={18} className="ml-auto shrink-0 text-gold-bright" />}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade">
            <Input
              type="number"
              min={1}
              max={pendente}
              inputMode="numeric"
              value={qtd}
              className="num"
              onChange={(e) => {
                setQtd(e.target.value);
                const q = Number(e.target.value);
                if (Number.isFinite(q)) setValor(String(Number(div.preco) * q));
              }}
            />
          </Field>
          {tipo !== "produto" && (
            <Field label={sobra ? "Pessoa (opcional)" : "Pessoa"}>
              <Select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
                <option value="">Escolha…</option>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {tipo === "valor" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor recebido">
              <Input inputMode="decimal" className="num" value={valor} onChange={(e) => setValor(e.target.value)} />
            </Field>
            <Field label="Forma">
              <Select value={forma} onChange={(e) => setForma(Number(e.target.value))}>
                {Object.entries(FORMAS).map(([id, nome]) => (
                  <option key={id} value={id}>
                    {nome}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label={tipo === "acerto" ? "Comentário (obrigatório)" : "Comentário"}>
          <Textarea
            value={comentario}
            maxLength={MAX_TEXTO}
            placeholder={tipo === "acerto" ? "Ex.: acertado com a pessoa, descontado do salário" : "Opcional"}
            onChange={(e) => setComentario(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={enviando}>
            {enviando && <LoaderCircle size={16} className="animate-spin" />}
            Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
