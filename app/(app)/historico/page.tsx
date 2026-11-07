import type { ReactNode } from "react";
import { LogIn } from "lucide-react";
import { requireRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dataHora } from "@/lib/domain";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { Exportar } from "@/components/exportar";

const duracao = (de: string, ate: string | null) => {
  if (!ate) return null;
  const min = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
};

const TIPOS: Record<string, { label: string; tone: "danger" | "neutral" | "gold" }> = {
  anulacao: { label: "Anulação", tone: "danger" },
  edicao: { label: "Edição", tone: "neutral" },
  troca_vendedor: { label: "Troca de vendedor", tone: "gold" },
  edicao_amostra: { label: "Edição de amostra", tone: "gold" },
};

const nomeDe = (p: unknown) => (p as { nome: string } | null)?.nome ?? "—";

export default async function HistoricoPage() {
  await requireRole(90);
  const supabase = await createClient();
  const [{ data: acessos }, { data: eventos }] = await Promise.all([
    supabase
      .from("acessos")
      .select("id, entrada, saida, ip, profiles(nome)")
      .order("entrada", { ascending: false })
      .limit(200),
    supabase
      .from("eventos")
      .select("id, tipo, descricao, created_at, profiles(nome)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <>
      <PageHeader title="Histórico" subtitle="Últimos acessos ao sistema e alterações em vendas e amostras" />
      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
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
            Acessos
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
            {!acessos?.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhum acesso registrado.</p>}
          </Card>
        </section>

        <section>
          <Titulo
            exportar={
              <Exportar
                arquivo="eventos-vendas"
                titulo="Eventos de vendas e amostras"
                subtitulo="Anulações, edições de venda e de amostra, trocas de vendedor"
                paisagem
                colunas={[
                  { titulo: "Data", tipo: "data" },
                  { titulo: "Tipo", largura: 18 },
                  { titulo: "Descrição", largura: 60 },
                  { titulo: "Por", largura: 24 },
                ]}
                linhas={(eventos ?? []).map((e) => [
                  e.created_at,
                  TIPOS[e.tipo]?.label ?? e.tipo,
                  e.descricao,
                  nomeDe(e.profiles),
                ])}
              />
            }
          >
            Eventos de vendas e amostras
          </Titulo>
          <Card className="divide-y divide-line">
            {(eventos ?? []).map((e) => (
              <div key={e.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <Badge tone={TIPOS[e.tipo]?.tone ?? "neutral"}>{TIPOS[e.tipo]?.label ?? e.tipo}</Badge>
                  <span className="text-xs text-muted">{dataHora(e.created_at)}</span>
                </div>
                <p className="mt-1 text-sm">{e.descricao}</p>
                <p className="text-xs text-muted">por {nomeDe(e.profiles)}</p>
              </div>
            ))}
            {!eventos?.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhum evento.</p>}
          </Card>
        </section>
      </div>
    </>
  );
}

function Titulo({ children, exportar }: { children: ReactNode; exportar: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-2xl font-bold">{children}</h2>
      {exportar}
    </div>
  );
}
