import type { ReactNode } from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { requireRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { FORMAS, ROLES, TZ, dataHora, hojeISO, intervaloDia, type Role } from "@/lib/domain";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { Exportar } from "@/components/exportar";

// Só administração: quem fez o quê e quando. Filtros na URL (formulário GET), a página renderiza no servidor.

const duracao = (de: string, ate: string | null) => {
  if (!ate) return null;
  const min = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
};

const TIPOS: Record<string, { label: string; tone: "danger" | "neutral" | "gold" | "ok" }> = {
  anulacao: { label: "Anulação", tone: "danger" },
  edicao: { label: "Edição de venda", tone: "neutral" },
  troca_vendedor: { label: "Troca de vendedor", tone: "gold" },
  devolucao: { label: "Devolução", tone: "danger" },
  desfazer_devolucao: { label: "Devolução desfeita", tone: "neutral" },
  edicao_amostra: { label: "Edição de amostra", tone: "gold" },
  edicao_movimento: { label: "Correção de estoque", tone: "gold" },
  recuperacao: { label: "Recuperação", tone: "ok" },
  desfazer_recuperacao: { label: "Recuperação desfeita", tone: "neutral" },
  gestao: { label: "Gestão de pessoas", tone: "neutral" },
};

// Auditoria: nomes amigáveis de tabela e campo; campos técnicos ficam fora
const TABELAS: Record<string, string> = {
  lojas: "Loja",
  profiles: "Pessoa",
  loja_membros: "Pessoa na loja",
  produtos: "Produto",
  vendas: "Venda",
  estoque_movimentos: "Lançamento de estoque",
  metas: "Meta individual",
  metas_loja: "Meta da loja",
  devolucoes: "Devolução",
  recuperacoes: "Recuperação",
};
const ACOES: Record<string, string> = { INSERT: "criou", UPDATE: "alterou", DELETE: "apagou" };
const CAMPOS: Record<string, string> = {
  nome: "nome",
  usuario: "usuário",
  descricao: "descrição",
  preco: "preço",
  valor_combo: "valor combo",
  a_venda: "à venda",
  ativo: "ativo",
  estoque_minimo: "estoque mínimo",
  tipo: "tipo",
  quantidade: "quantidade",
  comentario: "comentário",
  motivo_edicao: "justificativa",
  role: "perfil",
  idioma: "idioma",
  acesso_habilitado: "acesso",
  total: "total",
  troco: "troco",
  anulada: "anulada",
  motivo_anulacao: "motivo da anulação",
  vendedor_id: "vendedor",
  user_id: "pessoa",
  produto_id: "produto",
  loja_id: "loja",
  venda_id: "venda",
  meta_minima: "mínima",
  meta_media: "média",
  meta_full: "máxima",
  meta_maxima: "máxima",
  volta_estoque: "volta ao estoque",
  devolve_valor: "devolve valor",
  valor: "valor",
  forma: "forma",
  motivo: "motivo",
  responsavel_id: "pessoa",
  motivo_desfeita: "justificativa (desfeito)",
};
const OCULTOS = new Set([
  "id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "editado_por",
  "editado_em",
  "quantidade_anterior",
  "saldo_anterior",
  "entradas",
  "saidas",
  "desfeita_por",
  "desfeita_em",
  "anulada_por",
  "anulada_em",
  "devolucao_id",
  "recuperacao_id",
  "movimento_id",
]);

type Nomes = { pessoas: Map<string, string>; produtos: Map<number, string>; lojas: Map<number, string> };

function valor(campo: string, v: unknown, n: Nomes): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (campo === "vendedor_id" || campo === "user_id" || campo === "responsavel_id") return n.pessoas.get(String(v)) ?? "—";
  if (campo === "produto_id") return n.produtos.get(Number(v)) ?? `#${v}`;
  if (campo === "loja_id") return n.lojas.get(Number(v)) ?? `#${v}`;
  if (campo === "role") return ROLES[Number(v) as Role] ?? String(v);
  if (campo === "forma") return FORMAS[Number(v)] ?? String(v);
  return String(v);
}

// "nome: Âmbar → Âmbar Noir; preço: 10 → 12" (UPDATE) ou os campos principais (INSERT/DELETE)
function mudancas(acao: string, antes: Record<string, unknown> | null, depois: Record<string, unknown> | null, n: Nomes) {
  const base = (acao === "DELETE" ? antes : depois) ?? {};
  const campos = Object.keys(base).filter((k) => !OCULTOS.has(k) && k in CAMPOS);
  if (acao === "UPDATE")
    return campos.map((k) => `${CAMPOS[k]}: ${valor(k, antes?.[k], n)} → ${valor(k, depois?.[k], n)}`).join("; ");
  return campos
    .filter((k) => base[k] !== null && base[k] !== "")
    .slice(0, 8)
    .map((k) => `${CAMPOS[k]}: ${valor(k, base[k], n)}`)
    .join("; ");
}

function registro(tabela: string, antes: Record<string, unknown> | null, depois: Record<string, unknown> | null, id: string | null, n: Nomes) {
  const r = { ...antes, ...depois };
  if (typeof r.nome === "string") return r.nome;
  if (r.produto_id) return n.produtos.get(Number(r.produto_id)) ?? `#${id}`;
  if (tabela === "loja_membros" || tabela === "metas") return n.pessoas.get(String(r.user_id)) ?? "";
  if (tabela === "vendas") return `nº ${String(id).padStart(6, "0")}`;
  return id ? `#${id}` : "";
}

const nomeDe = (p: unknown) => (p as { nome: string } | null)?.nome ?? "Sistema / Gestão";
const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000).toLocaleDateString("sv-SE", { timeZone: TZ });
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
type Aba = "eventos" | "alteracoes" | "acessos";

export default async function HistoricoPage({ searchParams }: PageProps<"/historico">) {
  await requireRole(100);
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const aba: Aba = s("aba") === "alteracoes" || s("aba") === "acessos" ? (s("aba") as Aba) : "eventos";
  const de = DATA_RE.test(s("de")) ? s("de") : diasAtras(6);
  const ate = DATA_RE.test(s("ate")) ? s("ate") : hojeISO();
  const pessoa = /^[0-9a-f-]{36}$/.test(s("pessoa")) ? s("pessoa") : "";
  const tipo = s("tipo");
  const ini = intervaloDia(de).de;
  const fim = intervaloDia(ate).ate;

  const supabase = await createClient();
  const [{ data: pessoas }, { data: produtos }, { data: lojas }] = await Promise.all([
    supabase.from("profiles").select("id, nome").order("nome"),
    supabase.from("produtos").select("id, nome"),
    supabase.from("lojas").select("id, nome"),
  ]);
  const nomes: Nomes = {
    pessoas: new Map((pessoas ?? []).map((p) => [p.id as string, p.nome as string])),
    produtos: new Map((produtos ?? []).map((p) => [p.id as number, p.nome as string])),
    lojas: new Map((lojas ?? []).map((l) => [l.id as number, l.nome as string])),
  };

  const filtros = { aba, de, ate, pessoa, tipo };
  const href = (patch: Partial<typeof filtros>) =>
    `/historico?${new URLSearchParams(Object.entries({ ...filtros, ...patch }).filter(([, v]) => v) as [string, string][])}`;

  let conteudo: ReactNode;
  if (aba === "eventos") {
    let q = supabase
      .from("eventos")
      .select("id, tipo, descricao, created_at, loja_id, profiles(nome)")
      .gte("created_at", ini)
      .lte("created_at", fim)
      .order("created_at", { ascending: false })
      .limit(500);
    if (pessoa) q = q.eq("user_id", pessoa);
    if (tipo && tipo in TIPOS) q = q.eq("tipo", tipo);
    const { data: eventos } = await q;
    conteudo = (
      <section>
        <Titulo
          exportar={
            <Exportar
              arquivo={`eventos-${de}-a-${ate}`}
              titulo="Eventos"
              subtitulo={`${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")}`}
              paisagem
              colunas={[
                { titulo: "Data", tipo: "data" },
                { titulo: "Tipo", largura: 20 },
                { titulo: "Loja", largura: 16 },
                { titulo: "Descrição", largura: 70 },
                { titulo: "Por", largura: 22 },
              ]}
              linhas={(eventos ?? []).map((e) => [
                e.created_at,
                TIPOS[e.tipo]?.label ?? e.tipo,
                e.loja_id ? (nomes.lojas.get(e.loja_id) ?? "") : "",
                e.descricao,
                nomeDe(e.profiles),
              ])}
            />
          }
        >
          {eventos?.length ?? 0} evento(s){(eventos?.length ?? 0) === 500 && " (mostrando os 500 mais recentes)"}
        </Titulo>
        <Card className="divide-y divide-line">
          {(eventos ?? []).map((e) => (
            <div key={e.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TIPOS[e.tipo]?.tone ?? "neutral"}>{TIPOS[e.tipo]?.label ?? e.tipo}</Badge>
                <span className="text-xs text-muted">
                  {dataHora(e.created_at)}
                  {e.loja_id && ` · ${nomes.lojas.get(e.loja_id) ?? ""}`}
                </span>
              </div>
              <p className="mt-1 text-sm">{e.descricao}</p>
              <p className="text-xs text-muted">por {nomeDe(e.profiles)}</p>
            </div>
          ))}
          {!eventos?.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhum evento no período.</p>}
        </Card>
      </section>
    );
  } else if (aba === "alteracoes") {
    let q = supabase
      .from("auditoria")
      .select("id, created_at, tabela, acao, registro_id, antes, depois, loja_id, profiles(nome)")
      .gte("created_at", ini)
      .lte("created_at", fim)
      .order("created_at", { ascending: false })
      .limit(500);
    if (pessoa) q = q.eq("user_id", pessoa);
    if (tipo && tipo in TABELAS) q = q.eq("tabela", tipo);
    const { data: alts } = await q;
    const linhas = (alts ?? []).map((a) => ({
      ...a,
      oQue: `${TABELAS[a.tabela] ?? a.tabela} ${registro(a.tabela, a.antes, a.depois, a.registro_id, nomes)}`.trim(),
      detalhe: mudancas(a.acao, a.antes, a.depois, nomes),
    }));
    conteudo = (
      <section>
        <Titulo
          exportar={
            <Exportar
              arquivo={`alteracoes-${de}-a-${ate}`}
              titulo="Todas as alterações"
              subtitulo={`${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")}`}
              paisagem
              colunas={[
                { titulo: "Data", tipo: "data" },
                { titulo: "Quem", largura: 22 },
                { titulo: "Ação", largura: 10 },
                { titulo: "O quê", largura: 34 },
                { titulo: "Loja", largura: 16 },
                { titulo: "Detalhe", largura: 70 },
              ]}
              linhas={linhas.map((a) => [
                a.created_at,
                nomeDe(a.profiles),
                ACOES[a.acao],
                a.oQue,
                a.loja_id ? (nomes.lojas.get(a.loja_id) ?? "") : "",
                a.detalhe,
              ])}
            />
          }
        >
          {linhas.length} alteração(ões){linhas.length === 500 && " (mostrando as 500 mais recentes)"}
        </Titulo>
        <Card className="divide-y divide-line">
          {linhas.map((a) => (
            <div key={a.id} className="px-4 py-3 sm:px-5">
              <div className="text-sm">
                <b>{nomeDe(a.profiles)}</b> {ACOES[a.acao]} <b>{a.oQue}</b>
              </div>
              <div className="text-xs text-muted">
                {dataHora(a.created_at)}
                {a.loja_id && ` · ${nomes.lojas.get(a.loja_id) ?? ""}`}
              </div>
              {a.detalhe && <p className="mt-1 text-xs break-words">{a.detalhe}</p>}
            </div>
          ))}
          {!linhas.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma alteração no período.</p>}
        </Card>
      </section>
    );
  } else {
    let q = supabase
      .from("acessos")
      .select("id, entrada, saida, ip, profiles(nome)")
      .gte("entrada", ini)
      .lte("entrada", fim)
      .order("entrada", { ascending: false })
      .limit(500);
    if (pessoa) q = q.eq("user_id", pessoa);
    const { data: acessos } = await q;
    conteudo = (
      <section>
        <Titulo
          exportar={
            <Exportar
              arquivo="acessos"
              titulo="Acessos ao sistema"
              subtitulo={`Últimos ${acessos?.length ?? 0} acessos`}
              colunas={[
                { titulo: "Pessoa", largura: 28 },
                { titulo: "Entrada", tipo: "data" },
                { titulo: "Saída", tipo: "data" },
                { titulo: "Duração", largura: 11 },
                { titulo: "IP", largura: 16 },
              ]}
              linhas={(acessos ?? []).map((a) => [
                nomeDe(a.profiles),
                a.entrada,
                a.saida,
                duracao(a.entrada, a.saida) ?? "sem logout",
                a.ip,
              ])}
            />
          }
        >
          {acessos?.length ?? 0} acesso(s)
        </Titulo>
        <Card className="divide-y divide-line">
          {(acessos ?? []).map((a) => {
            const nome = nomeDe(a.profiles);
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar nome={nome} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{nome}</div>
                  <div className="text-xs text-muted">
                    <LogIn size={11} className="mr-1 inline" />
                    {dataHora(a.entrada)} → {a.saida ? dataHora(a.saida) : "sem logout"}
                  </div>
                </div>
                {duracao(a.entrada, a.saida) && <Badge>{duracao(a.entrada, a.saida)}</Badge>}
              </div>
            );
          })}
          {!acessos?.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhum acesso no período.</p>}
        </Card>
      </section>
    );
  }

  const opcoesTipo = aba === "eventos" ? TIPOS : aba === "alteracoes" ? TABELAS : null;
  const ABAS: { value: Aba; label: string }[] = [
    { value: "eventos", label: "Eventos" },
    { value: "alteracoes", label: "Todas as alterações" },
    { value: "acessos", label: "Acessos" },
  ];

  return (
    <>
      <PageHeader
        title="Histórico"
        subtitle="Quem fez o quê e quando: vendas, devoluções, estoque, recuperados, metas, pessoas e acessos."
        actions={
          <nav
            aria-label="Abas do histórico"
            className="flex w-full flex-wrap gap-1 rounded-2xl border border-line/80 bg-card p-1 shadow-card sm:inline-flex sm:w-auto"
          >
            {ABAS.map((a) => (
              <Link
                key={a.value}
                href={href({ aba: a.value, tipo: "" })}
                aria-current={aba === a.value ? "page" : undefined}
                // sem cx(): ui.tsx é "use client" e função de módulo cliente não roda no servidor
                className={`grid h-9 flex-1 place-items-center rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition sm:flex-none sm:px-4 ${
                  aba === a.value ? "bg-ink text-white shadow-sm" : "text-muted hover:bg-ink/5 hover:text-ink"
                }`}
              >
                {a.label}
              </Link>
            ))}
          </nav>
        }
      />

      <form method="get" className="mb-6 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-end">
        <input type="hidden" name="aba" value={aba} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          De
          <input type="date" name="de" defaultValue={de} max={ate} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Até
          <input type="date" name="ate" defaultValue={ate} max={hojeISO()} className={CAMPO} />
        </label>
        <label className="col-span-2 flex flex-col gap-1.5 text-sm font-medium sm:col-span-1">
          Pessoa
          <select name="pessoa" defaultValue={pessoa} className={CAMPO}>
            <option value="">Todas</option>
            {(pessoas ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        {opcoesTipo && (
          <label className="col-span-2 flex flex-col gap-1.5 text-sm font-medium sm:col-span-1">
            {aba === "eventos" ? "Tipo" : "O quê"}
            <select name="tipo" defaultValue={tipo} className={CAMPO}>
              <option value="">Todos</option>
              {Object.entries(opcoesTipo).map(([k, v]) => (
                <option key={k} value={k}>
                  {typeof v === "string" ? v : v.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="col-span-2 h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-2 active:scale-[0.97] sm:col-span-1"
        >
          Filtrar
        </button>
      </form>

      {conteudo}
    </>
  );
}

const CAMPO =
  "h-11 w-full rounded-xl border border-line bg-card px-3 text-base text-ink transition focus:border-gold focus:ring-4 focus:ring-gold/15 focus:outline-none sm:w-auto sm:min-w-40";

function Titulo({ children, exportar }: { children: ReactNode; exportar: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-muted">{children}</h2>
      {exportar}
    </div>
  );
}
