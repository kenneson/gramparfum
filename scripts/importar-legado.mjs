// Importa o dump MySQL do sistema PHP (phpMyAdmin) para o Supabase.
// Uso: node --env-file=.env.local scripts/importar-legado.mjs [dump.sql] [--seco]
// --seco só lê o dump e mostra as contagens. Pode rodar de novo: usuários já criados são
// reaproveitados (user_metadata.legado_id) e linhas com ID já existente são ignoradas.
// Pedidos/carrinhos em aberto do legado não são importados.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const seco = args.includes("--seco");
const arquivo = args.find((a) => !a.startsWith("--")) ?? new URL("../supabase/legacy/banco.sql", import.meta.url);

const BAN = "876000h"; // igual a gestao/actions.ts
const USUARIO_RE = /^[a-z0-9._-]{3,32}$/;
const ESC = { n: "\n", r: "\r", t: "\t", 0: "\0" };

// ───────── Parser dos INSERTs do phpMyAdmin ─────────

function lerValores(s, i) {
  const linhas = [];
  let linha;
  for (;;) {
    const c = s[i];
    if (c === ";") return linhas;
    if (c === "(") {
      linha = [];
      i++;
    } else if (c === ")") {
      linhas.push(linha);
      i++;
    } else if (c === "'") {
      let v = "";
      for (i++; s[i] !== "'" || s[i + 1] === "'"; i++) {
        if (s[i] === "\\") v += ESC[s[++i]] ?? s[i];
        else if (s[i] === "'") v += s[++i]; // '' → '
        else v += s[i];
      }
      linha.push(v);
      i++;
    } else if (/[\s,]/.test(c)) {
      i++;
    } else {
      let j = i;
      while (s[j] !== "," && s[j] !== ")") j++;
      const v = s.slice(i, j).trim();
      linha.push(v === "NULL" ? null : v);
      i = j;
    }
  }
}

const dump = readFileSync(arquivo, "utf8");
const d = {};
for (const m of dump.matchAll(/INSERT INTO `(\w+)` \(([^)]*)\) VALUES\s*/g)) {
  const cols = m[2].split(",").map((c) => c.trim().replaceAll("`", ""));
  const linhas = lerValores(dump, m.index + m[0].length);
  (d[m[1]] ??= []).push(...linhas.map((l) => Object.fromEntries(cols.map((c, i) => [c, l[i]]))));
}

// ───────── Helpers ─────────

const vivo = (r) => r.borrado === "0";
const quando = (s) => (s ? `${s.replace(" ", "T")}-03:00` : null); // o PHP gravava em America/Sao_Paulo
const centavos = (v) => Math.round(Number(v) * 100);
const texto = (s) => s?.trim() || null;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const check = ({ data, error }, ctx) => {
  if (error) throw new Error(`${ctx}: ${error.message}`);
  return data;
};

async function inserir(tabela, linhas, onConflict = "id") {
  if (!seco) {
    for (let i = 0; i < linhas.length; i += 1000) {
      const r = await admin.from(tabela).upsert(linhas.slice(i, i + 1000), { onConflict, ignoreDuplicates: true });
      check(r, tabela);
    }
  }
  console.log(`${tabela}: ${linhas.length}`);
}

// ───────── Pessoas → Auth + profiles ─────────

const uid = new Map(); // idPersona → uuid
const usados = new Set();
if (!seco) {
  for (let page = 1; ; page++) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "listUsers");
    for (const u of users) if (u.user_metadata?.legado_id) uid.set(String(u.user_metadata.legado_id), u.id);
    if (users.length < 1000) break;
  }
  for (const p of check(await admin.from("profiles").select("usuario"), "profiles")) usados.add(p.usuario);
}

// Ativos primeiro: em login repetido (@ANNE/@Anne) o ativo de menor ID fica com o nome limpo
const pessoas = d.cpessoas.toSorted((a, b) => vivo(b) - vivo(a) || a.idPersona - b.idPersona);
let criados = 0;
for (const p of pessoas) {
  if (uid.has(p.idPersona)) continue;
  const base = (p.usuario ?? "").trim().replace(/^@/, "").toLowerCase() || `legado${p.idPersona}`;
  let usuario = base;
  for (let n = 2; usados.has(usuario); n++) usuario = `${base}${n}`;
  if (!USUARIO_RE.test(usuario)) throw new Error(`Usuário inválido: "${p.usuario}" (id ${p.idPersona})`);
  usados.add(usuario);
  criados++;
  if (seco) {
    if (usuario !== base || vivo(p)) console.log(`  id ${p.idPersona} → @${usuario}${vivo(p) ? " (ativo)" : ""}`);
    continue;
  }

  const habilitado = vivo(p) && p.habilitacionIng === "1";
  const { user } = check(
    await admin.auth.admin.createUser({
      email: `${usuario}@gamparfum.local`,
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
      ban_duration: habilitado ? "none" : BAN,
      user_metadata: { legado_id: Number(p.idPersona) },
    }),
    `@${usuario}`,
  );
  try {
    check(
      await admin.from("profiles").insert({
        id: user.id,
        nome: p.nomePessoa.trim(),
        usuario,
        role: [50, 90, 100, 200].includes(Number(p.tipoUser)) ? Number(p.tipoUser) : 50,
        idioma: p.IDidioma === "2" ? "es" : "pt",
        descricao: texto(p.descricao),
        acesso_habilitado: habilitado,
        ativo: vivo(p),
        created_at: quando(p.dataIng) ?? undefined,
      }),
      `profile @${usuario}`,
    );
    if (habilitado && p.passIng) {
      check(await admin.from("senhas_legado").insert({ user_id: user.id, sha1: p.passIng.toLowerCase() }), "senha");
    }
  } catch (e) {
    await admin.auth.admin.deleteUser(user.id); // não deixar usuário de auth órfão
    throw e;
  }
  uid.set(p.idPersona, user.id);
}
console.log(`usuários criados: ${criados}`);
const user = (id) => uid.get(id) ?? null;

// ───────── Lojas, equipe, produtos ─────────

await inserir(
  "lojas",
  d.a_centrocostos.map((r) => ({
    id: Number(r.idCentroCosto),
    nome: r.centroCosto.trim(),
    ativo: vivo(r),
    created_at: quando(r.dataIng),
  })),
);

const membros = new Map();
for (const r of d.a_centrocostos_pessoas) {
  if (!uid.has(r.idUser) && !seco) continue;
  const ativo = vivo(r) && r.estatus === "100";
  const k = `${r.idCentroCosto}:${r.idUser}`;
  if (!membros.get(k)?.ativo) membros.set(k, { loja_id: Number(r.idCentroCosto), user_id: user(r.idUser), ativo });
}
await inserir("loja_membros", [...membros.values()], "loja_id,user_id");

await inserir(
  "produtos",
  d.inv_equipamento.map((r) => ({
    id: Number(r.idEquipamento),
    loja_id: Number(r.idCentroCosto),
    nome: r.nomeEquipo.trim(),
    descricao: texto(r.descricao),
    preco: Number(r.valorVenda),
    valor_combo: Number(r.valorCombo),
    a_venda: r.estatusVenda === "1",
    ativo: vivo(r),
    created_by: user(r.idUserIng),
    created_at: quando(r.dataIng),
  })),
);

// ───────── Vendas ─────────

// O legado gravava o valor entregue em dinheiro; no novo o dinheiro fica líquido do troco
const pagtos = Map.groupBy(
  d.money_vendas_formaspago.map((r) => ({
    id: Number(r.idVendaFormaPago),
    venda_id: Number(r.idVenda),
    forma: Number(r.idForma),
    valor: centavos(r.valor),
    comentario: texto(r.comentario),
  })),
  (p) => p.venda_id,
);
const vendas = d.money_vendas.map((r) => {
  const ps = pagtos.get(Number(r.idVenda)) ?? [];
  const excesso = Math.max(0, ps.reduce((s, p) => s + p.valor, 0) - centavos(r.valorVenda));
  let troco = 0;
  for (const p of ps.filter((p) => p.forma === 2).sort((a, b) => b.valor - a.valor)) {
    const tira = Math.min(excesso - troco, p.valor);
    p.valor -= tira;
    troco += tira;
  }
  return {
    id: Number(r.idVenda),
    loja_id: Number(r.idCentroCosto),
    vendedor_id: user(r.idVendedor),
    total: Number(r.valorVenda),
    troco: troco / 100,
    anulada: !vivo(r),
    created_by: user(r.IDuserIng),
    created_at: quando(r.dataIng),
  };
});
await inserir("vendas", vendas);
await inserir(
  "venda_pagamentos",
  [...pagtos.values()].flat().map((p) => ({ ...p, valor: p.valor / 100 })),
);

// idVenda=0 são saídas para amostra; itens de venda anulada entram (a venda já fica anulada)
await inserir(
  "venda_itens",
  d.money_vendas_produtos
    .filter((r) => r.idVenda !== "0")
    .map((r) => ({
      id: Number(r.idVendaProduto),
      venda_id: Number(r.idVenda),
      produto_id: Number(r.idProduto),
      preco_tabela: Number(r.valorTabela),
      preco: Number(r.valorCobrado),
      quantidade: Number(r.quant),
      valor_combo: Number(r.valorCombo),
    })),
);

// ───────── Estoque: inventários + compras + amostras numa tabela só ─────────

const movimentos = [
  ...d.inv_equipamento_movimentos.filter(vivo).map((r) => ({
    produto_id: Number(r.idEquipamento),
    tipo: "inventario",
    quantidade: Math.max(0, Number(r.quantFIM)), // 6 contagens negativas antigas, todas já superadas por inventário posterior
    saldo_anterior: Number(r.quantOLD),
    entradas: Number(r.quantIN),
    saidas: Number(r.quantOUT),
    comentario: texto(r.descricao),
    created_by: user(r.idUserIng),
    created_at: r.dataIng,
  })),
  ...d.money_compra_produtos.filter(vivo).map((r) => ({
    produto_id: Number(r.idProduto),
    tipo: "entrada",
    quantidade: Number(r.quant),
    comentario: texto(r.descricao),
    created_by: user(r.IDuserIng),
    created_at: r.dataIng,
  })),
  ...d.money_vendas_produtos
    .filter((r) => r.idVenda === "0" && vivo(r))
    .map((r) => ({
      produto_id: Number(r.idProduto),
      tipo: "amostra",
      quantidade: Number(r.quant),
      comentario: texto(r.descricao),
      created_by: user(r.IDuserIng),
      created_at: r.dataIng,
    })),
];
// ponytail: IDs por ordem cronológica, estáveis entre execuções enquanto o dump for o mesmo
await inserir(
  "estoque_movimentos",
  movimentos
    .toSorted((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    .map((m, i) => ({ saldo_anterior: null, entradas: null, saidas: null, ...m, id: i + 1, created_at: quando(m.created_at) })),
);

// ───────── Histórico ─────────

await inserir(
  "eventos",
  d.a_eventossist
    .filter((r) => vivo(r) && (r.tipoEvento === "101" || r.tipoEvento === "102"))
    .map((r) => ({
      id: Number(r.idEventoSist),
      tipo: r.tipoEvento === "101" ? "troca_vendedor" : "anulacao",
      venda_id: Number(r.ID_1),
      descricao: (r.metaDato ?? "").replace(/<[^>]+>/g, "").trim(),
      user_id: user(r.IDuserIng),
      created_at: quando(r.dataIng),
    })),
);

await inserir(
  "acessos",
  d.hist_acessossistema
    .filter((r) => seco || uid.has(r.IDuserIng))
    .map((r) => ({
      id: Number(r.idAcesso),
      user_id: user(r.IDuserIng),
      ip: texto(r.IPaddress),
      entrada: quando(r.dataIng),
      saida: quando(r.dataOut),
    })),
);

if (!seco) check(await admin.rpc("ajustar_sequencias"), "ajustar_sequencias");
console.log(seco ? "Simulação concluída, nada foi gravado." : "Importação concluída.");
