"use server";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { normalizarUsuario, usuarioToEmail, type Idioma, type Role } from "@/lib/domain";

type Res = { error?: string };
const BAN = "876000h"; // ~100 anos
const USUARIO_RE = /^[a-z0-9._-]{3,32}$/;

async function lojasDe(userId: string) {
  const { data } = await createAdminClient()
    .from("loja_membros")
    .select("loja_id")
    .eq("user_id", userId)
    .eq("ativo", true);
  return new Set((data ?? []).map((m) => m.loja_id as number));
}

// Regras do legado: admin do sistema gerencia todos; os demais só quem tem nível
// inferior e divide ao menos uma loja (ou a si mesmo, para dados pessoais).
async function autorizar(alvoId: string, opts: { permitirSiMesmo?: boolean } = {}) {
  const { profile: ator } = await getSession();
  if (ator.role < 90) throw new Error("Sem permissão");
  const { data: alvo } = await createAdminClient().from("profiles").select("*").eq("id", alvoId).single();
  if (!alvo) throw new Error("Pessoa não encontrada");
  if (ator.role === 200) return { ator, alvo };
  if (alvo.id === ator.id) {
    if (opts.permitirSiMesmo) return { ator, alvo };
    throw new Error("Você não pode alterar isso no seu próprio usuário");
  }
  if (alvo.role >= ator.role) throw new Error("Sem permissão sobre este usuário");
  const [a, b] = await Promise.all([lojasDe(ator.id), lojasDe(alvo.id)]);
  if (![...b].some((l) => a.has(l))) throw new Error("Usuário não pertence às suas lojas");
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
    return { error: /duplicate|already|unique/i.test(msg) ? "Este usuário já existe" : msg };
  }
};

const check = <T extends { error: { message: string } | null }>(r: T) => {
  if (r.error) throw new Error(r.error.message);
  return r;
};

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
    if (ator.role < 90 || !(await acessaLoja(input.lojaId))) throw new Error("Sem permissão");
    const usuario = normalizarUsuario(input.usuario);
    if (!USUARIO_RE.test(usuario)) throw new Error("Usuário: 3 a 32 caracteres (letras minúsculas, números, . _ -)");
    if (!input.nome.trim()) throw new Error("Informe o nome");
    if (input.senha && input.senha.length < 6) throw new Error("A senha precisa de ao menos 6 caracteres");

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
          nome: input.nome.trim(),
          usuario,
          descricao: input.descricao.trim() || null,
          idioma: input.idioma,
          role: 50,
          acesso_habilitado: habilitado,
        }),
      );
      check(await admin.from("loja_membros").insert({ loja_id: input.lojaId, user_id: uid }));
    } catch (e) {
      await admin.auth.admin.deleteUser(uid); // não deixar usuário de auth órfão
      throw e;
    }
  });
}

export async function atualizarDados(
  id: string,
  input: { nome: string; descricao: string; idioma: Idioma },
): Promise<Res> {
  return run(async () => {
    await autorizar(id, { permitirSiMesmo: true });
    if (!input.nome.trim()) throw new Error("Informe o nome");
    check(
      await createAdminClient()
        .from("profiles")
        .update({ nome: input.nome.trim(), descricao: input.descricao.trim() || null, idioma: input.idioma })
        .eq("id", id),
    );
  });
}

export async function atualizarAcesso(
  id: string,
  input: { usuario: string; senha: string; habilitado: boolean },
): Promise<Res> {
  return run(async () => {
    const { alvo } = await autorizar(id, { permitirSiMesmo: true });
    const usuario = normalizarUsuario(input.usuario);
    if (!USUARIO_RE.test(usuario)) throw new Error("Usuário: 3 a 32 caracteres (letras minúsculas, números, . _ -)");
    if (input.senha && input.senha.length < 6) throw new Error("A senha precisa de ao menos 6 caracteres");
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
    check(await admin.from("profiles").update({ acesso_habilitado: input.habilitado }).eq("id", id));
  });
}

export async function atualizarRole(id: string, role: Role): Promise<Res> {
  return run(async () => {
    const { ator } = await autorizar(id);
    if (ator.role < 100) throw new Error("Só administradores alteram perfis");
    if (ator.role !== 200 && role >= ator.role) throw new Error("Você só pode atribuir perfis abaixo do seu");
    check(await createAdminClient().from("profiles").update({ role }).eq("id", id));
  });
}

export async function definirLoja(id: string, lojaId: number, ativo: boolean): Promise<Res> {
  return run(async () => {
    await autorizar(id);
    if (!(await acessaLoja(lojaId))) throw new Error("Sem permissão nesta loja");
    check(
      await createAdminClient()
        .from("loja_membros")
        .upsert({ loja_id: lojaId, user_id: id, ativo }, { onConflict: "loja_id,user_id" }),
    );
  });
}

export async function definirAtivo(id: string, ativo: boolean): Promise<Res> {
  return run(async () => {
    const { alvo } = await autorizar(id);
    const admin = createAdminClient();
    check(await admin.from("profiles").update({ ativo }).eq("id", id));
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: ativo && alvo.acesso_habilitado ? "none" : BAN,
    });
    if (error) throw new Error(error.message);
  });
}
