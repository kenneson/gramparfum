import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Loja, Profile, Role } from "@/lib/domain";

// Uma vez por request: perfil do usuário logado + lojas visíveis (RLS)
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect("/login");

  const [{ data: profile }, { data: lojas }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).single<Profile>(),
    supabase.from("lojas").select("id, nome, ativo").eq("ativo", true).order("nome").returns<Loja[]>(),
  ]);
  if (!profile || !profile.ativo) redirect("/login?erro=inativo");

  return { profile, lojas: lojas ?? [] };
});

export async function requireRole(min: Role) {
  const s = await getSession();
  if (s.profile.role < min) redirect("/caixa");
  return s;
}
