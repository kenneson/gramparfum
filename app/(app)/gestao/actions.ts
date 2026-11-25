"use server";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import {
  ROLES,
  normalizarUsuario,
  usuarioToEmail,
  type Idioma,
  type Role,
} from "@/lib/domain";
import { MAX_NOME, campoTexto, validar } from "@/lib/texto";

type Res = { error?: string };
const BAN = "876000h"; // ~100 anos
const USUARIO_RE = /^[a-z0-9._-]{3,32}$/;
const IDIOMAS: Idioma[] = ["pt", "es"];
const EXCLUIDO = "excluido-"; // usuário de quem foi excluído com histórico (libera o original)

// Nome obrigatório, comentário opcional (mesma regra do banco); lança com a mensagem do primeiro erro
function dadosPessoais(input: {
  nome: string;
  descricao: string;
  idioma: Idioma;
}) {
  const { erro, valores } = validar({
    nome: campoTexto(input.nome, "Nome", { obrigatorio: true, max: MAX_NOME }),
    descricao: campoTexto(input.descricao, "Comentário"),
  });
  if (erro) throw new Error(erro);
  if (!IDIOMAS.includes(input.idioma)) throw new Error("Idioma inválido");
  return {
    nome: valores.nome!,
    descricao: valores.descricao,
    idioma: input.idioma,
  };
}

function senhaValida(senha: string) {
  if (senha && (senha.length < 6 || !senha.trim()))
    throw new Error("A senha precisa de ao menos 6 caracteres");
}

async function lojasDe(userId: string) {
  const { data } = await createAdminClient()
    .from("loja_membros")
    .select("loja_id")
    .eq("user_id", userId)
    .eq("ativo", true);
  return new Set((data ?? []).map((m) => m.loja_id as number));
}

// Admin do sistema gerencia todos; admin de lojas, quem tem nível inferior e divide ao menos uma loja.
// Chefe de loja só cadastra vendedores (criarPessoa) e altera os próprios dados: não edita outras pessoas.
async function autorizar(
  alvoId: string,
  opts: { permitirSiMesmo?: boolean } = {},
) {
  const { profile: ator } = await getSession();
  if (ator.role < 90) throw new Error("Sem permissão");
  const { data: alvo } = await createAdminClient()
    .from("profiles")
    .select("*")
    .eq("id", alvoId)
    .single();
  if (!alvo) throw new Error("Pessoa não encontrada");
  if (ator.role === 200) return { ator, alvo };
  if (alvo.id === ator.id) {
    if (opts.permitirSiMesmo) return { ator, alvo };
    throw new Error("Você não pode alterar isso no seu próprio usuário");
  }
  if (ator.role < 100)
    throw new Error("Só a administração altera os dados de outras pessoas");
  if (alvo.role >= ator.role)
    throw new Error("Sem permissão sobre este usuário");
  const [a, b] = await Promise.all([lojasDe(ator.id), lojasDe(alvo.id)]);
  if (![...b].some((l) => a.has(l)))
    throw new Error("Usuário não pertence às suas lojas");
  return { ator, alvo };
}

async function acessaLoja(lojaId: number) {
  const { profile } = await getSession();
  return profile.role === 200 || (await lojasDe(profile.id)).has(lojaId);
}

const run = async (fn: () => Promise<unknown>): Promise<Res> => {
  try {
    await fn();
    return {};
  } catch (e) {
    const msg = (e as Error).message;
    return {
      error: /duplicate|already|unique/i.test(msg)
        ? "Este usuário já existe"
        : msg,
    };
  }
};

const check = <T extends { error: { message: string } | null }>(r: T) => {
  if (r.error) throw new Error(r.error.message);
  return r;
};

// Histórico: a Gestão grava com a chave de serviço (no banco não há usuário), então o autor vai no evento.
// Sem loja informada, usa uma loja da pessoa (o admin de lojas só vê eventos das lojas dele).
async function registrar(
  atorId: string,
  alvoId: string,
  descricao: string,
  lojaId?: number,
) {
  const loja = lojaId ?? [...(await lojasDe(alvoId))][0] ?? null;
  await createAdminClient()
    .from("eventos")
    .insert({ tipo: "gestao", descricao, user_id: atorId, loja_id: loja });
}

const nomeLoja = async (id: number) =>
  (await createAdminClient().from("lojas").select("nome").eq("id", id).single())
    .data?.nome ?? `loja ${id}`;

export async function criarPessoa(input: {
  nome: string;
  usuario: string;
  descricao: string;
  idioma: Idioma;
  senha: string;
  lojaId: number;
}): Promise<Res> {
  return run(async () => {
    const { profile: ator } = await getSession();
    if (ator.role < 90 || !(await acessaLoja(input.lojaId)))
      throw new Error("Sem permissão");
    const usuario = normalizarUsuario(input.usuario);
    if (!USUARIO_RE.test(usuario) || usuario.startsWith(EXCLUIDO))
      throw new Error(
        "Usuário: 3 a 32 caracteres (letras minúsculas, números, . _ -)",
      );
    const dados = dadosPessoais(input);
    senhaValida(input.senha);
    if (!Number.isInteger(input.lojaId)) throw new Error("Loja inválida");

    const admin = createAdminClient();
    const habilitado = !!input.senha;
    const { data, error } = await admin.auth.admin.createUser({
      email: usuarioToEmail(usuario),
      password: input.senha || randomBytes(24).toString("base64url"),
      email_confirm: true,
      ban_duration: habilitado ? "none" : BAN,
    });
    if (error) throw new Error(error.message);

    const uid = data.user.id;
    try {
      check(
        await admin.from("profiles").insert({
          id: uid,
          ...dados,
          usuario,
          role: 50,
          acesso_habilitado: habilitado,
        }),
      );
      check(
        await admin
          .from("loja_membros")
          .insert({ loja_id: input.lojaId, user_id: uid }),
      );
    } catch (e) {
      await admin.auth.admin.deleteUser(uid); // não deixar usuário de auth órfão
      throw e;
    }
    await registrar(
      ator.id,
      uid,
      `${ator.nome} cadastrou ${dados.nome} (usuário ${usuario}) em ${await nomeLoja(input.lojaId)}${habilitado ? ", com acesso" : ", sem acesso"}`,
      input.lojaId,
    );
  });
}

export async function atualizarDados(
  id: string,
  input: { nome: string; descricao: string; idioma: Idioma },
): Promise<Res> {
  return run(async () => {
    const dados = dadosPessoais(input);
    const { ator, alvo } = await autorizar(id, { permitirSiMesmo: true });
    check(
      await createAdminClient().from("profiles").update(dados).eq("id", id),
    );
    const mudou = [
      alvo.nome !== dados.nome && `nome "${alvo.nome}" → "${dados.nome}"`,
      (alvo.descricao ?? null) !== dados.descricao && "comentário",
      alvo.idioma !== dados.idioma && `idioma ${alvo.idioma} → ${dados.idioma}`,
    ].filter(Boolean);
    if (mudou.length)
      await registrar(ator.id, id, `${ator.nome} alterou dados de ${alvo.nome}: ${mudou.join("; ")}`);
  });
}

export async function atualizarAcesso(
  id: string,
  input: { usuario: string; senha: string; habilitado: boolean },
): Promise<Res> {
  return run(async () => {
    const { ator, alvo } = await autorizar(id, { permitirSiMesmo: true });
    const usuario = normalizarUsuario(input.usuario);
    if (!USUARIO_RE.test(usuario) || usuario.startsWith(EXCLUIDO))
      throw new Error(
        "Usuário: 3 a 32 caracteres (letras minúsculas, números, . _ -)",
      );
    senhaValida(input.senha);
    if (input.habilitado && !alvo.acesso_habilitado && !input.senha)
      throw new Error("Defina uma senha para habilitar o acesso");

    const admin = createAdminClient();
    if (usuario !== alvo.usuario) {
      check(await admin.from("profiles").update({ usuario }).eq("id", id));
    }
    const { error } = await admin.auth.admin.updateUserById(id, {
      email: usuarioToEmail(usuario),
      email_confirm: true,
      ...(input.senha && { password: input.senha }),
      ban_duration: input.habilitado && alvo.ativo ? "none" : BAN,
    });
    if (error) throw new Error(error.message);
    check(
      await admin
        .from("profiles")
        .update({ acesso_habilitado: input.habilitado })
        .eq("id", id),
    );
    const mudou = [
      usuario !== alvo.usuario && `usuário ${alvo.usuario} → ${usuario}`,
      input.senha && "senha trocada",
      input.habilitado !== alvo.acesso_habilitado &&
        (input.habilitado ? "acesso habilitado" : "acesso desabilitado"),
    ].filter(Boolean);
    if (mudou.length)
      await registrar(ator.id, id, `${ator.nome} alterou o acesso de ${alvo.nome}: ${mudou.join("; ")}`);
  });
}

export async function atualizarRole(id: string, role: Role): Promise<Res> {
  return run(async () => {
    const { ator, alvo } = await autorizar(id);
    if (ator.role < 100) throw new Error("Só administradores alteram perfis");
    if (ator.role !== 200 && role >= ator.role)
      throw new Error("Você só pode atribuir perfis abaixo do seu");
    check(
      await createAdminClient().from("profiles").update({ role }).eq("id", id),
    );
    if (role !== alvo.role)
      await registrar(
        ator.id,
        id,
        `${ator.nome} mudou o perfil de ${alvo.nome}: ${ROLES[alvo.role as Role]} → ${ROLES[role]}`,
      );
  });
}

// Colocar ou tirar alguém de uma loja: só administração. O chefe de loja não escolhe lojas (pedido do dono);
// quem ele cadastra entra na loja dele.
export async function definirLoja(
  id: string,
  lojaId: number,
  ativo: boolean,
): Promise<Res> {
  return run(async () => {
    const { ator, alvo } = await autorizar(id);
    if (ator.role < 100)
      throw new Error("Só a administração define as lojas de cada pessoa");
    if (!(await acessaLoja(lojaId)))
      throw new Error("Sem permissão nesta loja");
    check(
      await createAdminClient()
        .from("loja_membros")
        .upsert(
          { loja_id: lojaId, user_id: id, ativo },
          { onConflict: "loja_id,user_id" },
        ),
    );
    await registrar(
      ator.id,
      id,
      `${ator.nome} ${ativo ? "colocou" : "tirou"} ${alvo.nome} ${ativo ? "em" : "de"} ${await nomeLoja(lojaId)}`,
      lojaId,
    );
  });
}

export async function definirAtivo(id: string, ativo: boolean): Promise<Res> {
  return run(async () => {
    const { ator, alvo } = await autorizar(id);
    if (ator.role < 100)
      throw new Error("Só a administração tira ou volta pessoas da empresa");
    const admin = createAdminClient();
    check(await admin.from("profiles").update({ ativo }).eq("id", id));
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: ativo && alvo.acesso_habilitado ? "none" : BAN,
    });
    if (error) throw new Error(error.message);
    await registrar(
      ator.id,
      id,
      `${ator.nome} marcou ${alvo.nome} como ${ativo ? "ativo (voltou à empresa)" : "fora da empresa"}`,
    );
  });
}

// Onde a pessoa aparece como autora de algo que precisa ficar no histórico (vendas, estoque, caixa, eventos).
// Com qualquer registro, excluir apagaria o histórico: aí a pessoa vai para "Fora da empresa".
const HISTORICO: [tabela: string, colunas: string[], nome: string][] = [
  ["vendas", ["vendedor_id", "created_by", "anulada_por"], "vendas"],
  ["estoque_movimentos", ["created_by", "editado_por"], "lançamentos de estoque"],
  ["devolucoes", ["created_by", "desfeita_por"], "devoluções"],
  ["recuperacoes", ["created_by", "desfeita_por", "responsavel_id"], "recuperados"],
  ["eventos", ["user_id"], "registros no histórico"],
  ["produtos", ["created_by"], "produtos cadastrados"],
  ["metas", ["updated_by"], "metas definidas"],
  ["metas_loja", ["updated_by"], "metas definidas"],
  ["privacidade", ["created_by"], "ajustes de privacidade"],
];

async function historicoDe(id: string) {
  const admin = createAdminClient();
  const achados = await Promise.all(
    HISTORICO.map(async ([tabela, colunas, nome]) => {
      const { count, error } = await admin
        .from(tabela)
        .select("*", { count: "exact", head: true })
        .or(colunas.map((c) => `${c}.eq.${id}`).join(","));
      if (error) throw new Error(error.message);
      return count ? nome : null;
    }),
  );
  return [...new Set(achados.filter((n): n is string => !!n))];
}

// Excluir (só o admin do sistema, nunca a si mesmo). O usuário (login) sempre fica livre para outra pessoa.
// Sem histórico: apaga de vez (perfil, lojas, metas, acessos e carrinhos abertos vão junto).
// Com histórico (vendas, estoque, caixa...): apagar mudaria os relatórios do passado, então a pessoa é arquivada:
// o nome continua nas vendas antigas, mas sai das lojas, perde o acesso e o usuário vira "excluido-…".
export async function excluirPessoa(id: string): Promise<Res> {
  return run(async () => {
    const { ator, alvo } = await autorizar(id);
    if (ator.role !== 200) throw new Error("Só o administrador do sistema exclui usuários");
    if (alvo.id === ator.id) throw new Error("Você não pode excluir o seu próprio usuário");

    const admin = createAdminClient();
    const loja = [...(await lojasDe(id))][0];
    const hist = await historicoDe(id);
    check(await admin.from("pedidos").delete().eq("vendedor_id", id));
    check(await admin.from("pedidos").update({ created_by: null }).eq("created_by", id));

    if (!hist.length) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (!error) {
        await registrar(ator.id, ator.id, `${ator.nome} excluiu o usuário ${alvo.nome} (@${alvo.usuario})`, loja);
        return;
      }
      // algo foi lançado no meio do caminho: arquiva como quem tem histórico
    }

    const livre = `${EXCLUIDO}${id.replaceAll("-", "").slice(0, 12)}`;
    const { error } = await admin.auth.admin.updateUserById(id, {
      email: usuarioToEmail(livre),
      email_confirm: true,
      password: randomBytes(24).toString("base64url"),
      ban_duration: BAN,
    });
    if (error) throw new Error(error.message);
    check(
      await admin
        .from("profiles")
        .update({ usuario: livre, ativo: false, acesso_habilitado: false })
        .eq("id", id),
    );
    check(await admin.from("loja_membros").update({ ativo: false }).eq("user_id", id));
    await admin.from("senhas_legado").delete().eq("user_id", id); // a senha do sistema antigo não entra mais
    await registrar(
      ator.id,
      ator.id,
      `${ator.nome} excluiu o usuário ${alvo.nome} (@${alvo.usuario}); como tem ${hist.join(", ") || "histórico"}, o nome fica nas vendas antigas e o usuário @${alvo.usuario} está livre`,
      loja,
    );
  });
}
