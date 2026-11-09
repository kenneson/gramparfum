"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";
import { usuarioToEmail } from "@/lib/domain";
import { MAX_MOTIVO, campoTexto } from "@/lib/texto";

// Vendedor anula com o chefe digitando usuário e senha na hora: entra como o chefe numa sessão descartável
// e roda anular_venda como ele. O banco checa perfil (chefe+) e loja do chefe e grava ele como quem autorizou.
export async function anularComChefe(
  vendaId: number,
  motivo: string,
  usuario: string,
  senha: string,
): Promise<{ error?: string }> {
  const { profile } = await getSession();
  const m = campoTexto(motivo, "Motivo", { obrigatorio: true, max: MAX_MOTIVO });
  if (m.erro) return { error: m.erro };
  if (!usuario.trim() || !senha) return { error: "Informe usuário e senha do chefe" };

  const chefe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: login } = await chefe.auth.signInWithPassword({
    email: usuarioToEmail(usuario),
    password: senha,
  });
  if (login) return { error: "Usuário ou senha do chefe inválidos" };

  const { error } = await chefe.rpc("anular_venda", {
    p_venda_id: vendaId,
    p_motivo: `${m.valor} — solicitado por ${profile.nome}`,
  });
  await chefe.auth.signOut({ scope: "local" }); // só esta sessão; o chefe continua logado nos aparelhos dele
  return error ? { error: error.message } : {};
}
