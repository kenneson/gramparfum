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
for (const f of readdirSync(dir).sort())
  await db.exec(readFileSync(new URL(`migrations/${f}`, dir), "utf8"));

const ADM = "00000000-0000-0000-0000-000000000100",
  CHEFE = "00000000-0000-0000-0000-000000000090",
  VEND = "00000000-0000-0000-0000-000000000050";
// replica: dados "legados" (nomes de 2 letras) entram sem passar pelos triggers de validação de texto
await db.exec(`
  set session_replication_role = replica;
  insert into auth.users values ('${ADM}'), ('${CHEFE}'), ('${VEND}');
  insert into public.profiles (id, nome, usuario, role) values
    ('${ADM}', 'Adm', 'adm', 100), ('${CHEFE}', 'Chefe', 'chefe', 90), ('${VEND}', 'Vend', 'vend', 50);
  insert into public.lojas (nome) values ('L1');
  insert into public.loja_membros (loja_id, user_id) values (1, '${ADM}'), (1, '${CHEFE}'), (1, '${VEND}');
  insert into public.produtos (loja_id, nome, preco, valor_combo) values (1, 'P1', 60, 5), (1, 'P2', 10, 1);
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, created_at) values
    (1, 'inventario', 10, now() - interval '1 hour'), (2, 'inventario', 10, now() - interval '1 hour');
  set session_replication_role = origin;
`);

const as = async (uid, sql, params) => {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
};
const fails = async (p, re) =>
  assert.match(
    await p.then(
      () => "ok",
      (e) => e.message,
    ),
    re,
  );
const estoque = async () =>
  Object.fromEntries(
    (
      await as(VEND, "select produto_id, estoque from public.estoque_loja(1)")
    ).map((r) => [r.produto_id, r.estoque]),
  );
const hoje = (
  await db.query(
    "select (now() at time zone 'America/Sao_Paulo')::date::text d",
  )
).rows[0].d;
const ontem = (
  await db.query(
    "select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text d",
  )
).rows[0].d;

// venda: 2 × P1 = 120; pix 50 + dinheiro 100 → troco 30, dinheiro líquido 70
await as(
  VEND,
  `insert into public.pedidos (loja_id, vendedor_id) values (1, '${VEND}')`,
);
await as(
  VEND,
  "insert into public.pedido_itens (pedido_id, produto_id, preco, quantidade) values (1, 1, 60, 2)",
);
const [{ v: venda }] = await as(
  VEND,
  "select public.finalizar_venda(1, $1) v",
  [
    JSON.stringify([
      { forma: 1, valor: 50 },
      { forma: 2, valor: 100 },
    ]),
  ],
);
let [v] = await db
  .query("select total, troco from public.vendas where id = $1", [venda])
  .then((r) => r.rows);
assert.equal(Number(v.total), 120);
assert.equal(Number(v.troco), 30);
assert.deepEqual(
  (
    await db.query(
      "select forma, valor::float from public.venda_pagamentos order by forma",
    )
  ).rows,
  [
    { forma: 1, valor: 50 },
    { forma: 2, valor: 70 },
  ],
);
assert.deepEqual(await estoque(), { 1: 8, 2: 10 }, "baixa automática na venda");

// edição: vendedor não pode; chefe troca para 1 × P1 + 3 × P2 = 90, pago no crédito
await fails(
  as(
    VEND,
    'select public.editar_venda($1, \'[{"produto_id":1,"preco":60,"quantidade":1}]\', \'[{"forma":2,"valor":60}]\')',
    [venda],
  ),
  /Sem permissão/,
);
await fails(
  as(
    CHEFE,
    'select public.editar_venda($1, \'[{"produto_id":1,"preco":60,"quantidade":1}]\', \'[{"forma":1,"valor":10}]\')',
    [venda],
  ),
  /insuficiente/,
);
await fails(
  as(
    CHEFE,
    'select public.editar_venda($1, \'[{"produto_id":1,"preco":60,"quantidade":0}]\', \'[]\')',
    [venda],
  ),
  /inválidos/,
);
await db.exec("update public.produtos set valor_combo = 99 where id = 1"); // combo histórico deve ser preservado
await as(CHEFE, "select public.editar_venda($1, $2, $3)", [
  venda,
  JSON.stringify([
    { produto_id: 1, preco: 60, quantidade: 1 },
    { produto_id: 2, preco: 10, quantidade: 3 },
  ]),
  JSON.stringify([{ forma: 3, valor: 90 }]),
]);
[v] = (
  await db.query("select total, troco from public.vendas where id = $1", [
    venda,
  ])
).rows;
assert.equal(Number(v.total), 90);
assert.equal(Number(v.troco), 0);
assert.deepEqual(
  (
    await db.query(
      "select produto_id, quantidade, valor_combo::float from public.venda_itens order by produto_id",
    )
  ).rows,
  [
    { produto_id: 1, quantidade: 1, valor_combo: 5 },
    { produto_id: 2, quantidade: 3, valor_combo: 1 },
  ],
);
assert.deepEqual(
  (await db.query("select forma, valor::float from public.venda_pagamentos"))
    .rows,
  [{ forma: 3, valor: 90 }],
);
assert.deepEqual(await estoque(), { 1: 9, 2: 7 }, "estoque acompanha a edição");
assert.equal(
  (
    await db.query(
      "select count(*)::int n from public.eventos where tipo = 'edicao'",
    )
  ).rows[0].n,
  1,
);

// leitura direta: sem colunas de valor; quantidades seguem legíveis (inventário)
await fails(as(CHEFE, "select total from public.vendas"), /permission denied/);
await fails(
  as(ADM, "select preco from public.venda_itens"),
  /permission denied/,
);
await fails(
  as(CHEFE, "select valor from public.venda_pagamentos"),
  /permission denied/,
);
assert.equal(
  (
    await as(
      CHEFE,
      "select i.quantidade from public.venda_itens i join public.vendas v on v.id = i.venda_id where not v.anulada",
    )
  ).length,
  2,
);

// relatório
const rel = async (uid, de, ate) =>
  (await as(uid, "select public.relatorio_vendas(1, $1, $2) r", [de, ate]))[0]
    .r;
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
await as(
  CHEFE,
  `insert into public.pedidos (loja_id, vendedor_id) values (1, '${CHEFE}')`,
);
await as(
  CHEFE,
  "insert into public.pedido_itens (pedido_id, produto_id, preco) values (2, 2, 10)",
);
await as(
  CHEFE,
  'select public.finalizar_venda(2, \'[{"forma":2,"valor":10}]\')',
);
assert.equal((await rel(VEND, hoje, hoje)).length, 1);
assert.equal((await rel(CHEFE, hoje, hoje)).length, 2);
// dinheiro aparece no multi-dia restrito
assert.equal(
  Number((await rel(CHEFE, ontem, hoje))[1].venda_pagamentos[0].valor),
  10,
);

// anular devolve ao estoque
await as(CHEFE, "select public.anular_venda($1)", [venda]);
await fails(
  as(
    CHEFE,
    'select public.editar_venda($1, \'[{"produto_id":1,"preco":60,"quantidade":1}]\', \'[{"forma":2,"valor":60}]\')',
    [venda],
  ),
  /anulada/,
);
assert.deepEqual(await estoque(), { 1: 10, 2: 9 }, "estorno ao anular");

// amostras: vendedor e chefe abrem; inventário/entrada só admin; cada amostra baixa uma unidade
const mov = (tipo, qtd = 1, produto = 1) =>
  `insert into public.estoque_movimentos (produto_id, tipo, quantidade) values (${produto}, '${tipo}', ${qtd}) returning id`;
const [{ id: amostraVend }] = await as(VEND, mov("amostra"));
const [{ id: amostraChefe }] = await as(CHEFE, mov("amostra"));
assert.deepEqual(
  await estoque(),
  { 1: 8, 2: 9 },
  "amostra dá baixa no estoque",
);
assert.equal(
  (
    await db.query(
      "select created_by from public.estoque_movimentos where id = $1",
      [amostraVend],
    )
  ).rows[0].created_by,
  VEND,
  "guarda quem abriu",
);
// qualquer membro lança qualquer tipo; doação só chefe+
await fails(
  as(VEND, mov("doacao")),
  /row-level security/,
  "vendedor não lança doação",
);
await fails(as(VEND, mov("amostra", 0)), /row-level security/);
await as(ADM, mov("entrada", 5));
await fails(
  as(
    CHEFE,
    "update public.estoque_movimentos set quantidade = 99 where id = $1",
    [amostraChefe],
  ),
  /permission denied/,
);

// edição: vendedor só as próprias; registra quem editou e o evento
await fails(
  as(VEND, "select public.editar_amostra($1, 2, null)", [amostraChefe]),
  /só edita as amostras que abriu/,
);
await as(VEND, "select public.editar_amostra($1, 2, 'provador novo')", [
  amostraVend,
]);
await as(CHEFE, "select public.editar_amostra($1, 0, null)", [amostraChefe]); // cancelada
const [ed] = (
  await db.query(
    "select quantidade, comentario, editado_por from public.estoque_movimentos where id = $1",
    [amostraVend],
  )
).rows;
assert.deepEqual(ed, {
  quantidade: 2,
  comentario: "provador novo",
  editado_por: VEND,
});
assert.deepEqual(
  await estoque(),
  { 1: 13, 2: 9 },
  "10 + 5 entrada - 2 amostra (a outra cancelada)",
);
const evs = (
  await db.query(
    "select descricao, user_id from public.eventos where tipo = 'edicao_amostra' order by id",
  )
).rows;
assert.equal(evs.length, 2);
assert.match(
  evs[0].descricao,
  /quantidade 1 → 2; comentário "" → "provador novo"/,
);
assert.match(evs[1].descricao, /cancelada \(era 1\)/);
await fails(
  as(VEND, "select public.editar_amostra($1, 1, null)", [venda]),
  /Amostra não encontrada/,
);

// lançamento com rascunho: confirmar grava tudo e apaga o rascunho na mesma transação
const confirmar = (uid, tipo, itens, com = null) =>
  as(uid, "select public.confirmar_movimento(1, $1, $2, $3) n", [
    tipo,
    JSON.stringify(itens),
    com,
  ]);
await as(
  VEND,
  `insert into public.estoque_rascunhos (loja_id, tipo, itens) values (1, 'avaria', '[]')`,
);
assert.equal(
  (await as(CHEFE, "select * from public.estoque_rascunhos")).length,
  0,
  "rascunho é só de quem criou",
);
await fails(
  confirmar(VEND, "doacao", [{ produto_id: 1, quantidade: 1 }]),
  /Doação só com autorização/,
);
await fails(
  confirmar(VEND, "avaria", [
    { produto_id: 1, quantidade: 1 },
    { produto_id: 1, quantidade: 2 },
  ]),
  /repetido/,
);
await fails(
  confirmar(VEND, "avaria", [{ produto_id: 1, quantidade: 0 }]),
  /inválidos/,
);
await fails(confirmar(VEND, "avaria", []), /Nenhum produto/);
const [{ n }] = await confirmar(
  VEND,
  "avaria",
  [
    { produto_id: 1, quantidade: 1 },
    { produto_id: 2, quantidade: 2 },
  ],
  "caiu",
);
assert.equal(n, 2);
assert.equal(
  (await as(VEND, "select * from public.estoque_rascunhos")).length,
  0,
  "rascunho apagado ao confirmar",
);
await confirmar(CHEFE, "doacao", [{ produto_id: 2, quantidade: 1 }]);
await confirmar(VEND, "devolucao", [{ produto_id: 1, quantidade: 1 }]);
assert.deepEqual(
  await estoque(),
  { 1: 13, 2: 6 },
  "avaria/doação baixam, devolução soma",
);

// contagem (qualquer membro): snapshot do período calculado no banco
await db.exec("update public.produtos set estoque_minimo = 7 where id = 2");
await confirmar(VEND, "inventario", [{ produto_id: 1, quantidade: 12 }]);
const [inv] = (
  await db.query(
    "select saldo_anterior, entradas, saidas from public.estoque_movimentos where tipo = 'inventario' order by id desc limit 1",
  )
).rows;
assert.deepEqual(
  inv,
  { saldo_anterior: 10, entradas: 6, saidas: 3 },
  "10 + (5 compra + 1 devolução) − (2 amostra + 1 avaria)",
);
const est = await as(
  VEND,
  "select produto_id, estoque, minimo from public.estoque_loja(1) order by produto_id",
);
assert.deepEqual(est, [
  { produto_id: 1, estoque: 12, minimo: 0 },
  { produto_id: 2, estoque: 6, minimo: 7 },
]);

// validação de texto no banco (mesma regra do app)
await fails(
  as(
    ADM,
    "insert into public.produtos (loja_id, nome, preco) values (1, '  ab  ', 10)",
  ),
  /Nome: escreva ao menos 3 letras/,
);
await fails(
  as(
    ADM,
    "insert into public.produtos (loja_id, nome, preco) values (1, '   ', 10)",
  ),
  /Nome: campo obrigatório/,
);
await fails(
  as(
    ADM,
    "insert into public.produtos (loja_id, nome, preco) values (1, '. . .', 10)",
  ),
  /3 letras/,
);
await fails(
  as(
    ADM,
    `insert into public.produtos (loja_id, nome, preco) values (1, '${"x".repeat(81)}', 10)`,
  ),
  /no máximo 80/,
);
const [novo] = await as(
  ADM,
  "insert into public.produtos (loja_id, nome, descricao, preco) values (1, '  Âmbar   Noir ', '   ', 10) returning nome, descricao",
);
assert.deepEqual(
  novo,
  { nome: "Âmbar Noir", descricao: null },
  "espaços juntados; opcional vazio vira null",
);
await fails(
  as(
    VEND,
    "insert into public.estoque_movimentos (produto_id, tipo, quantidade, comentario) values (1, 'amostra', 1, 'ok')",
  ),
  /Comentário: escreva ao menos 3 letras/,
);
await fails(
  confirmar(VEND, "avaria", [{ produto_id: 1, quantidade: 1 }], "ok"),
  /3 letras/,
);
await as(
  VEND,
  `insert into public.pedidos (loja_id, vendedor_id) values (1, '${VEND}')`,
);
await fails(
  as(VEND, "update public.pedidos set nome = 'Jo' where vendedor_id = $1", [
    VEND,
  ]),
  /Nome: escreva ao menos 3 letras/,
);
// legado: nome curto não trava a edição de outro campo da mesma linha
await as(
  ADM,
  "update public.produtos set descricao = 'Nova descrição' where id = 1",
);
assert.equal(
  (await db.query("select nome from public.produtos where id = 1")).rows[0]
    .nome,
  "P1",
);
await fails(
  as(ADM, "update public.produtos set nome = 'P9' where id = 1"),
  /3 letras/,
  "mas trocar o nome exige a regra",
);
await fails(
  db.query("update public.lojas set nome = 'L' where id = 1"),
  /Nome da loja/,
);

console.log("todos os testes passaram");
