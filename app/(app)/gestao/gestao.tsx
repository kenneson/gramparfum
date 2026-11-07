"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, Store } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useData } from "@/lib/use-data";
import { MAX_NOME, MAX_TEXTO, campoTexto, validar } from "@/lib/texto";
import {
  ROLES,
  money,
  num,
  type Idioma,
  type Loja,
  type Produto,
  type Profile,
  type Role,
} from "@/lib/domain";
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
  Select,
  Tabs,
  Textarea,
  Toggle,
} from "@/components/ui";
import { SemLoja, useApp } from "@/components/shell";
import {
  atualizarAcesso,
  atualizarDados,
  atualizarRole,
  criarPessoa,
  definirAtivo,
  definirLoja,
} from "./actions";

type Aba = "equipe" | "produtos" | "lojas";
const supabase = createClient();

export function Gestao() {
  const { profile, lojaId } = useApp();
  const [aba, setAba] = useState<Aba>("equipe");
  if (!lojaId && profile.role < 200) return <SemLoja />;

  const abas: { value: Aba; label: string }[] = [
    { value: "equipe", label: "Equipe" },
    { value: "produtos", label: "Produtos" },
  ];
  if (profile.role === 200) abas.push({ value: "lojas", label: "Lojas" });

  return (
    <>
      <PageHeader
        title="Gestão"
        actions={<Tabs value={aba} onChange={setAba} items={abas} />}
      />
      {aba === "equipe" && <Equipe />}
      {aba === "produtos" && <Produtos />}
      {aba === "lojas" && <Lojas />}
    </>
  );
}

/* ───────────── Equipe ───────────── */

type Pessoa = Profile & { lojas: number[] };

function Equipe() {
  const { profile, lojaId, lojas } = useApp();
  const [ativos, setAtivos] = useState<"1" | "0">("1");
  const [aberta, setAberta] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const buscar = useCallback(async () => {
    // admin do sistema vê todos; os demais, a equipe da loja selecionada
    let q = supabase
      .from("profiles")
      .select("*, loja_membros(loja_id, ativo)")
      .eq("ativo", ativos === "1")
      .order("nome");
    if (profile.role < 200) {
      const { data: m } = await supabase
        .from("loja_membros")
        .select("user_id")
        .eq("loja_id", lojaId!);
      q = q.in(
        "id",
        (m ?? []).map((r) => r.user_id),
      );
    }
    const { data } = await q;
    return (
      (data ?? []) as (Profile & {
        loja_membros: { loja_id: number; ativo: boolean }[];
      })[]
    )
      .filter(
        (p) =>
          profile.role === 200 || p.role < profile.role || p.id === profile.id,
      )
      .map((p): Pessoa => ({
        ...p,
        lojas: p.loja_membros.filter((m) => m.ativo).map((m) => m.loja_id),
      }));
  }, [ativos, lojaId, profile]);
  const [data, carregar] = useData(buscar);
  const pessoas = data ?? [];

  const nomeLoja = (id: number) => lojas.find((l) => l.id === id)?.nome;
  const sel = pessoas.find((p) => p.id === aberta) ?? null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={ativos}
          onChange={setAtivos}
          items={[
            { value: "1", label: "Ativos" },
            { value: "0", label: "Inativos" },
          ]}
        />
        {lojaId && (
          <Button onClick={() => setNovo(true)}>
            <Plus size={16} /> Nova pessoa
          </Button>
        )}
      </div>

      {pessoas.length === 0 ? (
        <Empty>Ninguém por aqui.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pessoas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setAberta(p.id)}
              className="flex items-start gap-3 rounded-2xl border border-line/80 bg-card p-4 text-left shadow-card transition hover:border-gold/60 hover:shadow-lift active:scale-[0.98]"
            >
              <Avatar nome={p.nome} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.nome}</div>
                <div className="truncate text-xs text-muted">@{p.usuario}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone="gold">{ROLES[p.role]}</Badge>
                  <Badge tone={p.acesso_habilitado ? "ok" : "neutral"}>
                    {p.acesso_habilitado ? "Acesso ON" : "Sem acesso"}
                  </Badge>
                  {p.lojas.map(
                    (l) => nomeLoja(l) && <Badge key={l}>{nomeLoja(l)}</Badge>,
                  )}
                </div>
              </div>
              <Pencil size={16} className="mt-1 shrink-0 text-muted" />
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!sel}
        onClose={() => setAberta(null)}
        title={sel?.nome ?? ""}
        wide
      >
        {sel && <EditarPessoa p={sel} onChange={carregar} />}
      </Modal>
      <NovaPessoa
        open={novo}
        onClose={() => setNovo(false)}
        onDone={carregar}
      />
    </>
  );
}

function useAcao(onChange: () => void) {
  const [pending, start] = useTransition();
  const exec = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else {
        toast.success(ok);
        onChange();
      }
    });
  return [pending, exec] as const;
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5 first:border-0 first:pt-0">
      <h3 className="mb-3 text-xs font-bold tracking-wide text-muted uppercase">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function EditarPessoa({ p, onChange }: { p: Pessoa; onChange: () => void }) {
  const { profile, lojas } = useApp();
  const [pending, exec] = useAcao(onChange);
  const [dados, setDados] = useState({
    nome: p.nome,
    descricao: p.descricao ?? "",
    idioma: p.idioma,
  });
  const [acesso, setAcesso] = useState({
    usuario: p.usuario,
    senha: "",
    habilitado: p.acesso_habilitado,
  });
  const proprio = p.id === profile.id;
  const rolesPermitidos = (Object.keys(ROLES).map(Number) as Role[]).filter(
    (r) => profile.role === 200 || r < profile.role,
  );

  return (
    <div className="flex flex-col gap-5">
      <Secao titulo="Dados pessoais">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Nome">
            <Input
              value={dados.nome}
              maxLength={MAX_NOME}
              onChange={(e) => setDados({ ...dados, nome: e.target.value })}
            />
          </Field>
          <Field label="Idioma">
            <Select
              value={dados.idioma}
              onChange={(e) =>
                setDados({ ...dados, idioma: e.target.value as Idioma })
              }
            >
              <option value="pt">Português</option>
              <option value="es">Español</option>
            </Select>
          </Field>
          <Field label="Comentário" className="sm:col-span-2">
            <Textarea
              value={dados.descricao}
              maxLength={MAX_TEXTO}
              onChange={(e) =>
                setDados({ ...dados, descricao: e.target.value })
              }
            />
          </Field>
        </div>
        <Button
          className="mt-3"
          disabled={pending}
          onClick={() =>
            exec(() => atualizarDados(p.id, dados), "Dados salvos")
          }
        >
          Salvar dados
        </Button>
      </Secao>

      <Secao titulo="Acesso ao sistema">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Usuário">
            <Input
              value={acesso.usuario}
              autoCapitalize="none"
              onChange={(e) =>
                setAcesso({ ...acesso, usuario: e.target.value })
              }
            />
          </Field>
          <Field label="Nova senha">
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="deixe em branco para manter"
              value={acesso.senha}
              onChange={(e) => setAcesso({ ...acesso, senha: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Toggle
            label="Pode entrar no sistema"
            checked={acesso.habilitado}
            disabled={proprio}
            onChange={(habilitado) => setAcesso({ ...acesso, habilitado })}
          />
          <Button
            disabled={pending}
            onClick={() =>
              exec(() => atualizarAcesso(p.id, acesso), "Acesso atualizado")
            }
          >
            <KeyRound size={16} /> Salvar acesso
          </Button>
        </div>
      </Secao>

      {!proprio && (
        <>
          <Secao titulo="Perfil">
            <Select
              value={p.role}
              disabled={pending || profile.role < 100}
              onChange={(e) =>
                exec(
                  () => atualizarRole(p.id, Number(e.target.value) as Role),
                  "Perfil alterado",
                )
              }
            >
              {rolesPermitidos.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r]}
                </option>
              ))}
            </Select>
            {profile.role < 100 && (
              <p className="mt-2 text-xs text-muted">
                Só administradores alteram perfis.
              </p>
            )}
          </Secao>

          <Secao titulo="Lojas">
            <div className="flex flex-col gap-3">
              {lojas.map((l: Loja) => (
                <Toggle
                  key={l.id}
                  label={l.nome}
                  disabled={pending}
                  checked={p.lojas.includes(l.id)}
                  onChange={(v) =>
                    exec(
                      () => definirLoja(p.id, l.id, v),
                      v ? `Associado a ${l.nome}` : `Removido de ${l.nome}`,
                    )
                  }
                />
              ))}
            </div>
          </Secao>

          <Secao titulo="Relação com a empresa">
            <Toggle
              label={p.ativo ? "Ativo" : "Fora da empresa"}
              checked={p.ativo}
              disabled={pending}
              onChange={(v) =>
                exec(
                  () => definirAtivo(p.id, v),
                  v ? "Pessoa reativada" : "Pessoa desativada",
                )
              }
            />
          </Secao>
        </>
      )}
    </div>
  );
}

function NovaPessoa({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { lojaId, lojas } = useApp();
  const [pending, start] = useTransition();
  return (
    <Modal open={open} onClose={onClose} title="Nova pessoa">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          start(async () => {
            const r = await criarPessoa({
              nome: String(f.get("nome")),
              usuario: String(f.get("usuario")),
              descricao: String(f.get("descricao")),
              idioma: f.get("idioma") as Idioma,
              senha: String(f.get("senha")),
              lojaId: lojaId!,
            });
            if (r.error) {
              toast.error(r.error);
              return;
            }
            toast.success("Pessoa cadastrada");
            onClose();
            onDone();
          });
        }}
      >
        <p className="text-sm text-muted">
          Entra como vendedor na loja{" "}
          <b>{lojas.find((l) => l.id === lojaId)?.nome}</b>. Sem senha, a pessoa
          aparece no caixa mas não entra no sistema.
        </p>
        <Field label="Nome">
          <Input
            name="nome"
            required
            minLength={3}
            maxLength={MAX_NOME}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Usuário">
            <Input
              name="usuario"
              required
              autoCapitalize="none"
              placeholder="maria.silva"
            />
          </Field>
          <Field label="Idioma">
            <Select name="idioma" defaultValue="pt">
              <option value="pt">Português</option>
              <option value="es">Español</option>
            </Select>
          </Field>
        </div>
        <Field label="Senha (opcional)">
          <Input
            name="senha"
            type="password"
            autoComplete="new-password"
            minLength={6}
          />
        </Field>
        <Field label="Comentário">
          <Textarea name="descricao" maxLength={MAX_TEXTO} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            Cadastrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Produtos ───────────── */

function Produtos() {
  const { profile, lojaId, idioma } = useApp();
  const [editando, setEditando] = useState<Produto | "novo" | null>(null);
  const podeEditar = profile.role >= 100;

  const buscar = useCallback(async () => {
    if (!lojaId) return [];
    const { data } = await supabase
      .from("produtos")
      .select("*")
      .eq("loja_id", lojaId)
      .eq("ativo", true)
      .order("nome");
    return (data ?? []) as Produto[];
  }, [lojaId]);
  const [data, carregar] = useData(buscar);
  const produtos = data ?? [];

  if (!lojaId) return <SemLoja />;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {produtos.length} produtos nesta loja
        </p>
        {podeEditar && (
          <Button onClick={() => setEditando("novo")}>
            <Plus size={16} /> Novo produto
          </Button>
        )}
      </div>
      {produtos.length === 0 ? (
        <Empty>Nenhum produto cadastrado.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {produtos.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{p.nome}</span>
                  {!p.a_venda && <Badge>fora de venda</Badge>}
                </div>
                {p.descricao && (
                  <div className="truncate text-xs text-muted">
                    {p.descricao}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="num font-display text-xl font-bold">
                  {money(p.preco, idioma)}
                </div>
                <div className="num text-xs text-gold-ink">
                  combo {num(p.valor_combo, 2)}
                </div>
              </div>
              {podeEditar && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Editar"
                  onClick={() => setEditando(p)}
                >
                  <Pencil size={16} />
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
      {editando && (
        <FormProduto
          key={editando === "novo" ? "novo" : editando.id}
          produto={editando}
          onClose={() => setEditando(null)}
          onDone={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

function FormProduto({
  produto,
  onClose,
  onDone,
}: {
  produto: Produto | "novo";
  onClose: () => void;
  onDone: () => void;
}) {
  const { lojaId } = useApp();
  const p = produto === "novo" ? null : produto;
  const [aVenda, setAVenda] = useState(p?.a_venda ?? true);

  async function salvar(f: FormData, remover = false) {
    const { erro, valores } = validar({
      nome: campoTexto(String(f.get("nome") ?? ""), "Nome", {
        obrigatorio: true,
        max: MAX_NOME,
      }),
      descricao: campoTexto(String(f.get("descricao") ?? ""), "Descrição"),
    });
    const preco = Number(f.get("preco"));
    const valor_combo = Number(f.get("valor_combo") || 0);
    const estoque_minimo = Number(f.get("estoque_minimo") || 0);
    // remover não exige o resto do formulário válido (produto antigo com dado ruim ainda sai do catálogo)
    if (!remover) {
      if (erro) return toast.error(erro);
      if (!(preco > 0))
        return toast.error("Preço: informe um valor maior que zero");
      if (!(valor_combo >= 0))
        return toast.error("Valor combo: não pode ser negativo");
      if (!Number.isInteger(estoque_minimo) || estoque_minimo < 0)
        return toast.error("Estoque mínimo: número inteiro, zero ou mais");
    }
    const row = remover
      ? { ativo: false }
      : {
          nome: valores.nome!,
          descricao: valores.descricao,
          preco,
          valor_combo,
          estoque_minimo,
          a_venda: aVenda,
        };
    const { error } = p
      ? await supabase.from("produtos").update(row).eq("id", p.id)
      : await supabase.from("produtos").insert({ ...row, loja_id: lojaId });
    if (error) return toast.error(error.message);
    toast.success(remover ? "Produto removido" : "Produto salvo");
    onDone();
  }

  return (
    <Modal open onClose={onClose} title={p ? "Editar produto" : "Novo produto"}>
      <form
        key={p?.id ?? "novo"}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar(new FormData(e.currentTarget));
        }}
      >
        <Field label="Nome">
          <Input
            name="nome"
            required
            minLength={3}
            maxLength={MAX_NOME}
            defaultValue={p?.nome}
            autoFocus
          />
        </Field>
        <Field label="Descrição">
          <Textarea
            name="descricao"
            maxLength={MAX_TEXTO}
            defaultValue={p?.descricao ?? ""}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço">
            <Input
              name="preco"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={p?.preco}
              inputMode="decimal"
            />
          </Field>
          <Field label="Valor combo">
            <Input
              name="valor_combo"
              type="number"
              step="0.01"
              min="0"
              defaultValue={p?.valor_combo ?? 0}
              inputMode="decimal"
            />
          </Field>
          <Field label="Estoque mínimo">
            <Input
              name="estoque_minimo"
              type="number"
              step="1"
              min="0"
              defaultValue={p?.estoque_minimo ?? 0}
              inputMode="numeric"
            />
          </Field>
        </div>
        <Toggle
          label="Disponível no caixa"
          checked={aVenda}
          onChange={setAVenda}
        />
        <div className="flex items-center justify-between gap-2 pt-2">
          {p ? (
            <Button
              variant="danger"
              size="sm"
              onClick={(e) => salvar(new FormData(e.currentTarget.form!), true)}
              title="O histórico de vendas é preservado"
            >
              Remover
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Lojas (admin do sistema) ───────────── */

function Lojas() {
  const router = useRouter();
  const [nome, setNome] = useState("");

  const buscar = useCallback(async () => {
    const { data } = await supabase
      .from("lojas")
      .select("id, nome, ativo")
      .order("nome");
    return (data ?? []) as Loja[];
  }, []);
  const [data, carregar] = useData(buscar);
  const lojas = data ?? [];

  async function mutar(
    q: PromiseLike<{ error: { message: string } | null }>,
    ok: string,
  ) {
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success(ok);
    carregar();
    router.refresh(); // atualiza o seletor de loja do topo
  }

  return (
    <div className="max-w-xl">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const c = campoTexto(nome, "Nome da loja", {
            obrigatorio: true,
            max: MAX_NOME,
          });
          if (c.erro) return toast.error(c.erro);
          mutar(
            supabase.from("lojas").insert({ nome: c.valor! }),
            "Loja criada",
          );
          setNome("");
        }}
      >
        <Input
          placeholder="Nome da nova loja"
          maxLength={MAX_NOME}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Button type="submit" size="lg">
          <Plus size={16} /> Criar
        </Button>
      </form>
      <Card className="divide-y divide-line">
        {lojas.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-5 py-3">
            <Store size={18} className="text-gold" />
            <span className="flex-1 font-semibold">{l.nome}</span>
            <Toggle
              label={l.ativo ? "Ativa" : "Inativa"}
              checked={l.ativo}
              onChange={(ativo) =>
                mutar(
                  supabase.from("lojas").update({ ativo }).eq("id", l.id),
                  "Loja atualizada",
                )
              }
            />
          </div>
        ))}
        {lojas.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted">
            Crie a primeira loja.
          </div>
        )}
      </Card>
    </div>
  );
}
