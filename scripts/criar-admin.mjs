// Cria o primeiro Admin do sistema (role 200).
// Uso: node --env-file=.env.local scripts/criar-admin.mjs <usuario> <senha> "<Nome completo>"
import { createClient } from "@supabase/supabase-js";

const [usuario, senha, nome] = process.argv.slice(2);
if (!usuario || !senha || !nome) {
  console.error('Uso: node --env-file=.env.local scripts/criar-admin.mjs <usuario> <senha> "<Nome>"');
  process.exit(1);
}

const u = usuario.replace(/^@/, "").toLowerCase();
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email: `${u}@gamparfum.local`,
  password: senha,
  email_confirm: true,
});
if (error) throw error;

const { error: e2 } = await admin
  .from("profiles")
  .insert({ id: data.user.id, nome, usuario: u, role: 200, acesso_habilitado: true });
if (e2) {
  await admin.auth.admin.deleteUser(data.user.id);
  throw e2;
}
console.log(`Admin @${u} criado. Entre no sistema e crie as lojas em Gestão → Lojas.`);
