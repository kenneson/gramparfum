// Roda as migrations do projeto num Postgres WASM com stubs do Supabase e testa venda/edição/relatório.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

// caminho fixo: o PGlite lê process.argv e quebra com argumentos extras
const dir = new URL("../supabase/migrations", import.meta.url);
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(`migrations/${f}`, dir), "utf8"));


const ADM = "00000000-0000-0000-0000-000000000100", CHEFE = "00000000-0000-0000-0000-000000000090",
  VEND = "00000000-0000-0000-0000-000000000050";
await db.exec(`
  insert into auth.users values ('${ADM}'), ('${CHEFE}'), ('${VEND}');
  insert into public.profiles (id, nome, usuario, role) values
    ('${ADM}', 'Adm', 'adm', 100), ('${CHEFE}', 'Chefe', 'chefe', 90), ('${VEND}', 'Vend', 'vend', 50);
  insert into public.lojas (nome) values ('L1');
  insert into public.loja_membros (loja_id, user_id) values (1, '${ADM}'), (1, '${CHEFE}'), (1, '${VEND}');
  insert into public.produtos (loja_id, nome, preco, valor_combo) values (1, 'P1', 60, 5), (1, 'P2', 10, 1);
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, created_at) values
    (1, 'inventario', 10, now() - interval '1 hour'), (2, 'inventario', 10, now() - interval '1 hour');
`);

const as = async (uid, sql, params) => {

  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
};
const fails = async (p, re) => assert.match(await p.then(() => "ok", (e) => e.message), re);
const estoque = async () =>
  Object.fromEntries((await as(VEND, "select produto_id, estoque from public.estoque_loja(1)")).map((r) => [r.produto_id, r.estoque]));
const hoje = (await db.query("select (now() at time zone 'America/Sao_Paulo')::date::text d")).rows[0].d;
const ontem = (await db.query("select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text d")).rows[0].d;

// venda: 2 × P1 = 120; pix 50 + dinheiro 100 → troco 30, dinheiro líquido 70
await as(VEND, `insert into public.pedidos (loja_id, vendedor_id) values (1, '${VEND}')`);
await as(VEND, "insert into public.pedido_itens (pedido_id, produto_id, preco, quantidade) values (1, 1, 60, 2)");
const [{ v: venda }] = await as(VEND, "select public.finalizar_venda(1, $1) v", [
  JSON.stringify([{ forma: 1, valor: 50 }, { forma: 2, valor: 100 }]),
]);
let [v] = await db.query("select total, troco from public.vendas where id = $1", [venda]).then((r) => r.rows);
assert.equal(Number(v.total), 120);
assert.equal(Number(v.troco), 30);
assert.deepEqual(
  (await db.query("select forma, valor::float from public.venda_pagamentos order by forma")).rows,
  [{ forma: 1, valor: 50 }, { forma: 2, valor: 70 }],
);
assert.deepEqual(await estoque(), { 1: 8, 2: 10 }, "baixa automática na venda");

// edição: vendedor não pode; chefe troca para 1 × P1 + 3 × P2 = 90, pago no crédito
await fails(as(VEND, "select public.editar_venda($1, '[{\"produto_id\":1,\"preco\":60,\"quantidade\":1}]', '[{\"forma\":2,\"valor\":60}]')", [venda]), /Sem permissão/);
await fails(as(CHEFE, "select public.editar_venda($1, '[{\"produto_id\":1,\"preco\":60,\"quantidade\":1}]', '[{\"forma\":1,\"valor\":10}]')", [venda]), /insuficiente/);
await fails(as(CHEFE, "select public.editar_venda($1, '[{\"produto_id\":1,\"preco\":60,\"quantidade\":0}]', '[]')", [venda]), /inválidos/);
await db.exec("update public.produtos set valor_combo = 99 where id = 1"); // combo histórico deve ser preservado
await as(CHEFE, "select public.editar_venda($1, $2, $3)", [
  venda,
  JSON.stringify([{ produto_id: 1, preco: 60, quantidade: 1 }, { produto_id: 2, preco: 10, quantidade: 3 }]),
  JSON.stringify([{ forma: 3, valor: 90 }]),
]);
[v] = (await db.query("select total, troco from public.vendas where id = $1", [venda])).rows;
assert.equal(Number(v.total), 90);
assert.equal(Number(v.troco), 0);
assert.deepEqual(
  (await db.query("select produto_id, quantidade, valor_combo::float from public.venda_itens order by produto_id")).rows,
  [{ produto_id: 1, quantidade: 1, valor_combo: 5 }, { produto_id: 2, quantidade: 3, valor_combo: 1 }],
);
assert.deepEqual((await db.query("select forma, valor::float from public.venda_pagamentos")).rows, [{ forma: 3, valor: 90 }]);
assert.deepEqual(await estoque(), { 1: 9, 2: 7 }, "estoque acompanha a edição");
assert.equal((await db.query("select count(*)::int n from public.eventos where tipo = 'edicao'")).rows[0].n, 1);

// leitura direta: sem colunas de valor; quantidades seguem legíveis (inventário)
await fails(as(CHEFE, "select total from public.vendas"), /permission denied/);
await fails(as(ADM, "select preco from public.venda_itens"), /permission denied/);
await fails(as(CHEFE, "select valor from public.venda_pagamentos"), /permission denied/);
assert.equal((await as(CHEFE, "select i.quantidade from public.venda_itens i join public.vendas v on v.id = i.venda_id where not v.anulada")).length, 2);

// relatório
const rel = async (uid, de, ate) => (await as(uid, "select public.relatorio_vendas(1, $1, $2) r", [de, ate]))[0].r;
let [r] = await rel(CHEFE, hoje, hoje);
assert.equal(Number(r.total), 90, "chefe: um dia = completo");
[r] = await rel(CHEFE, ontem, hoje);
assert.equal(r.total, null, "chefe: vários dias sem total");
assert.ok(r.venda_itens.every((i) => i.preco === null));
assert.deepEqual(r.venda_pagamentos, [], "chefe: vários dias só dinheiro");
assert.equal(r.venda_itens[0].produtos.nome, "P1");
[r] = await rel(ADM, ontem, hoje);
assert.equal(Number(r.total), 90, "admin: vários dias completo");
assert.equal(r.vendedor.nome, "Vend");
assert.equal(r.operador.nome, "Vend");
assert.deepEqual(await rel(ADM, ontem, ontem), []);
// vendedor só vê as próprias
await as(CHEFE, `insert into public.pedidos (loja_id, vendedor_id) values (1, '${CHEFE}')`);
await as(CHEFE, "insert into public.pedido_itens (pedido_id, produto_id, preco) values (2, 2, 10)");
await as(CHEFE, "select public.finalizar_venda(2, '[{\"forma\":2,\"valor\":10}]')");
assert.equal((await rel(VEND, hoje, hoje)).length, 1);
assert.equal((await rel(CHEFE, hoje, hoje)).length, 2);
// dinheiro aparece no multi-dia restrito
assert.equal(Number((await rel(CHEFE, ontem, hoje))[1].venda_pagamentos[0].valor), 10);

// anular devolve ao estoque
await as(CHEFE, "select public.anular_venda($1)", [venda]);
await fails(as(CHEFE, "select public.editar_venda($1, '[{\"produto_id\":1,\"preco\":60,\"quantidade\":1}]', '[{\"forma\":2,\"valor\":60}]')", [venda]), /anulada/);
assert.deepEqual(await estoque(), { 1: 10, 2: 9 }, "estorno ao anular");

console.log("todos os testes passaram");
