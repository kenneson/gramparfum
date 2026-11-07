"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { normalizarUsuario, usuarioToEmail } from "@/lib/domain";

export async function login(
  _: string | null,
  form: FormData,
): Promise<string | null> {
  const usuario = String(form.get("usuario") ?? "");
  const senha = String(form.get("senha") ?? "");
  if (!usuario || !senha) return "Informe usuário e senha.";

  const supabase = await createClient();
  const credenciais = { email: usuarioToEmail(usuario), password: senha };
  let { data, error } = await supabase.auth.signInWithPassword(credenciais);
  if (
    error?.code === "invalid_credentials" &&
    (await migrarSenhaLegado(usuario, senha))
  ) {
    ({ data, error } = await supabase.auth.signInWithPassword(credenciais));
  }
  if (error || !data.user) {
    return error?.code === "user_banned"
      ? "Acesso desabilitado. Fale com o administrador."
      : "Usuário ou senha inválidos.";
  }

  const { data: p } = await supabase
    .from("profiles")
    .select("acesso_habilitado, ativo")
    .eq("id", data.user.id)
    .single();
  if (!p?.acesso_habilitado || !p.ativo) {
    await supabase.auth.signOut();
    return "Acesso desabilitado. Fale com o administrador.";
  }

  const h = await headers();
  await supabase
    .from("acessos")
    .insert({ ip: h.get("x-forwarded-for")?.split(",")[0] ?? null });
  redirect("/caixa");
}

// Usuário importado do PHP: a senha ainda é o SHA1 antigo. Se bater, vira a senha do Auth.
async function migrarSenhaLegado(usuario: string, senha: string) {
  const admin = createAdminClient();
  const { data: p } = await admin
    .from("profiles")
    .select("id")
    .eq("usuario", normalizarUsuario(usuario))
    .maybeSingle();
  if (!p) return false;
  const sha1 = createHash("sha1").update(senha).digest("hex");
  const { data: legado } = await admin
    .from("senhas_legado")
    .select("user_id")
    .eq("user_id", p.id)
    .eq("sha1", sha1)
    .maybeSingle();
  if (!legado) return false;
  const { error } = await admin.auth.admin.updateUserById(p.id, {
    password: senha,
  });
  if (error) return false; // ex.: senha antiga curta demais para o Auth; o admin redefine em Gestão
  await admin.from("senhas_legado").delete().eq("user_id", p.id);
  return true;
}

export async function logout() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    const { data: ultimo } = await supabase
      .from("acessos")
      .select("id")
      .eq("user_id", data.claims.sub)
      .is("saida", null)
      .order("entrada", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimo)
      await supabase
        .from("acessos")
        .update({ saida: new Date().toISOString() })
        .eq("id", ultimo.id);
  }
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setIdioma(idioma: "pt" | "es") {
  if (idioma !== "pt" && idioma !== "es") return;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims)
    await supabase
      .from("profiles")
      .update({ idioma })
      .eq("id", data.claims.sub);
}
