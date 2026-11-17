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
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, saldo_anterior, created_at) values
    (1, 'inventario', 10, 10, now() - interval '1 hour'), (2, 'inventario', 10, 10, now() - interval '1 hour');
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
      await as(VEND, "select produto_id, estoque from public.estoque_loja(1) where produto_id <= 2")
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
// combos: o vendedor vê os de toda a equipe (só quantidades); venda do Vend = 1 × P1 + 3 × P2 = 8 combos
const combosDe = async (uid, de, ate) =>
  Object.fromEntries(
    (await as(uid, "select * from public.relatorio_combos(1, $1, $2)", [de, ate])).map((r) => [
      r.nome,
      [Number(r.combos), r.vendas],
    ]),
  );
assert.deepEqual(await combosDe(VEND, hoje, hoje), { Vend: [8, 1], Chefe: [1, 1] }, "vendedor vê a equipe");
assert.deepEqual(await combosDe(VEND, ontem, hoje), await combosDe(ADM, ontem, hoje));
assert.deepEqual(await combosDe(VEND, ontem, ontem), {});
assert.deepEqual(
  Object.keys((await as(VEND, "select * from public.relatorio_combos(1, $1, $1)", [hoje]))[0]).sort(),
  ["combos", "nome", "vendas", "vendedor_id"],
  "sem colunas de valor",
);
// vários dias abaixo da administração: nenhum valor (nem o dinheiro); dia anterior sozinho também não
assert.deepEqual((await rel(CHEFE, ontem, hoje))[1].venda_pagamentos, []);
await db.exec(`update public.vendas set created_at = created_at - interval '1 day' where id = ${venda}`);
const [velha] = await rel(CHEFE, ontem, ontem);
assert.equal(velha.total, null, "chefe: só hoje tem valores");
assert.equal(Number((await rel(ADM, ontem, ontem))[0].total), 90, "admin: qualquer dia");
await db.exec(`update public.vendas set created_at = created_at + interval '1 day' where id = ${venda}`);

// anular: só chefe+, motivo obrigatório; devolve ao estoque, grava quem/por quê e evento
await fails(
  as(VEND, "select public.anular_venda($1, 'Cliente desistiu')", [venda]),
  /autorização de chefe/,
);
await fails(as(CHEFE, "select public.anular_venda($1, '  ')", [venda]), /Motivo: campo obrigatório/);
await fails(as(CHEFE, "select public.anular_venda($1, 'ok')", [venda]), /Motivo: escreva ao menos 3 letras/);
await as(CHEFE, "select public.anular_venda($1, '  Cliente   desistiu ')", [venda]);
const anulada = (await rel(CHEFE, hoje, hoje)).find((v) => v.id === venda);
assert.equal(anulada.anulacao.motivo, "Cliente desistiu");
assert.equal(anulada.anulacao.por, "Chefe");
const [ev] = await db.query("select descricao, user_id from public.eventos where tipo = 'anulacao'").then((r) => r.rows);
assert.match(ev.descricao, /1× P1, 3× P2.*Motivo: Cliente desistiu/);
assert.equal(ev.user_id, CHEFE);
await fails(
  as(
    CHEFE,
    'select public.editar_venda($1, \'[{"produto_id":1,"preco":60,"quantidade":1}]\', \'[{"forma":2,"valor":60}]\')',
    [venda],
  ),
  /anulada/,
);
assert.deepEqual(await estoque(), { 1: 10, 2: 9 }, "estorno ao anular");

// pedido não pago: chefe troca o vendedor; carrinho junta no carrinho do destino, cliente salvo só muda de dono
const novoPedido = async (uid, dono, nome = null) =>
  (
    await as(uid, "insert into public.pedidos (loja_id, vendedor_id, nome) values (1, $1, $2) returning id", [
      dono,
      nome,
    ])
  )[0].id;
const carVend = await novoPedido(VEND, VEND);
await as(VEND, "insert into public.pedido_itens (pedido_id, produto_id, preco) values ($1, 2, 10)", [carVend]);
const carChefe = await novoPedido(CHEFE, CHEFE);
await as(CHEFE, "insert into public.pedido_itens (pedido_id, produto_id, preco) values ($1, 1, 60)", [carChefe]);
await fails(as(VEND, "select public.trocar_vendedor_pedido($1, $2)", [carVend, CHEFE]), /chefe/);
const [{ destino }] = await as(CHEFE, "select public.trocar_vendedor_pedido($1, $2) destino", [carVend, CHEFE]);
assert.equal(Number(destino), carChefe, "carrinho vai para o carrinho do destino");
assert.equal(
  (await db.query("select count(*)::int n from public.pedido_itens where pedido_id = $1", [carChefe])).rows[0].n,
  2,
);
assert.equal((await db.query("select 1 from public.pedidos where id = $1", [carVend])).rows.length, 0);
const salvo = await novoPedido(CHEFE, CHEFE, "Cliente Ana");
await as(CHEFE, "select public.trocar_vendedor_pedido($1, $2)", [salvo, VEND]);
assert.equal((await db.query("select vendedor_id from public.pedidos where id = $1", [salvo])).rows[0].vendedor_id, VEND);
await db.query("delete from public.pedidos where id in ($1, $2)", [carChefe, salvo]);

// lançamentos por perfil: vendedor só conta; chefe compra e abre amostra; doação/estragou só admin
const mov = (tipo, qtd = 1, produto = 1) =>
  `insert into public.estoque_movimentos (produto_id, tipo, quantidade) values (${produto}, '${tipo}', ${qtd}) returning id`;
await fails(as(VEND, mov("amostra")), /row-level security/, "vendedor não abre amostra");
await fails(as(VEND, mov("entrada", 5)), /row-level security/, "vendedor não agrega ao estoque");
await fails(as(CHEFE, mov("doacao")), /row-level security/, "doação só admin");
await fails(as(CHEFE, mov("avaria")), /row-level security/, "estragou só admin");
await fails(as(ADM, mov("devolucao")), /row-level security/, "devolução só pelo caixa");
await fails(as(ADM, mov("recuperacao")), /row-level security/, "recuperação só pela função");
const [{ id: amostraChefe }] = await as(CHEFE, mov("amostra"));
const [{ id: amostraAdm }] = await as(ADM, mov("amostra"));
await as(CHEFE, mov("entrada", 5));
assert.deepEqual(await estoque(), { 1: 13, 2: 9 }, "10 − 2 amostras + 5 compra");
assert.equal(
  (await db.query("select created_by from public.estoque_movimentos where id = $1", [amostraChefe])).rows[0].created_by,
  CHEFE,
  "guarda quem abriu",
);
await fails(
  as(CHEFE, "update public.estoque_movimentos set quantidade = 99 where id = $1", [amostraChefe]),
  /permission denied/,
);

// corrigir/desfazer: justificativa obrigatória; abaixo do admin só o que a pessoa lançou
await fails(
  as(CHEFE, "select public.editar_movimento($1, 2, null, 'corrigindo isso')", [amostraAdm]),
  /só altera os lançamentos que fez/,
);
await fails(
  as(CHEFE, "select public.editar_movimento($1, 2, 'provador novo', '   ')", [amostraChefe]),
  /Justificativa: campo obrigatório/,
);
await fails(
  as(CHEFE, "select public.editar_movimento($1, 2, 'provador novo', 'ok')", [amostraChefe]),
  /Justificativa: escreva ao menos 3 letras/,
);
await as(CHEFE, "select public.editar_movimento($1, 2, 'provador novo', 'abri dois provadores')", [amostraChefe]);
await as(ADM, "select public.editar_movimento($1, 0, null, 'lançado por engano')", [amostraAdm]);
const [ed] = (
  await db.query(
    "select quantidade, comentario, editado_por, motivo_edicao from public.estoque_movimentos where id = $1",
    [amostraChefe],
  )
).rows;
assert.deepEqual(ed, {
  quantidade: 2,
  comentario: "provador novo",
  editado_por: CHEFE,
  motivo_edicao: "abri dois provadores",
});
assert.deepEqual(await estoque(), { 1: 13, 2: 9 }, "10 + 5 compra − 2 amostra (a outra desfeita)");
const evs = (
  await db.query("select descricao, user_id from public.eventos where tipo = 'edicao_amostra' order by id")
).rows;
assert.equal(evs.length, 2);
assert.match(evs[0].descricao, /quantidade 1 → 2; comentário "" → "provador novo". Justificativa: abri dois provadores/);
assert.match(evs[1].descricao, /desfeita \(era 1\)/);
await fails(
  as(VEND, "select public.editar_movimento($1, 1, null, 'qualquer coisa')", [999999]),
  /Lançamento não encontrado/,
);

// lançamento com rascunho: confirmar grava tudo e apaga o rascunho na mesma transação
const confirmar = (uid, tipo, itens, com = null) =>
  as(uid, "select public.confirmar_movimento(1, $1, $2, $3) n", [tipo, JSON.stringify(itens), com]);
await as(ADM, `insert into public.estoque_rascunhos (loja_id, tipo, itens) values (1, 'avaria', '[]')`);
assert.equal((await as(CHEFE, "select * from public.estoque_rascunhos")).length, 0, "rascunho é só de quem criou");
await fails(confirmar(CHEFE, "doacao", [{ produto_id: 1, quantidade: 1 }]), /Só a administração/);
await fails(confirmar(VEND, "entrada", [{ produto_id: 1, quantidade: 1 }]), /Compra e amostra só pelo chefe/);
await fails(confirmar(ADM, "devolucao", [{ produto_id: 1, quantidade: 1 }]), /Devolução se faz no Caixa/);
await fails(
  confirmar(ADM, "avaria", [
    { produto_id: 1, quantidade: 1 },
    { produto_id: 1, quantidade: 2 },
  ]),
  /repetido/,
);
await fails(confirmar(ADM, "avaria", [{ produto_id: 1, quantidade: 0 }]), /inválidos/);
await fails(confirmar(ADM, "avaria", []), /Nenhum produto/);
const [{ n }] = await confirmar(
  ADM,
  "avaria",
  [
    { produto_id: 1, quantidade: 1 },
    { produto_id: 2, quantidade: 2 },
  ],
  "caiu",
);
assert.equal(n.length, 2, "devolve os ids gravados");
assert.equal((await as(ADM, "select * from public.estoque_rascunhos")).length, 0, "rascunho apagado ao confirmar");
await confirmar(ADM, "doacao", [{ produto_id: 2, quantidade: 1 }]);
await confirmar(CHEFE, "entrada", [{ produto_id: 1, quantidade: 1 }]);
assert.deepEqual(await estoque(), { 1: 13, 2: 6 }, "avaria/doação baixam, compra soma");

// desfazer o lançamento inteiro (com justificativa) e refazer cada produto
const [{ id: doacao }] = await db.query("select id from public.estoque_movimentos where tipo = 'doacao'").then((r) => r.rows);
await fails(
  as(CHEFE, "select public.desfazer_movimentos($1, 'lançado errado')", [[doacao]]),
  /só altera os lançamentos que fez/,
);
await fails(as(ADM, "select public.desfazer_movimentos($1, '')", [n]), /Justificativa/);
await as(ADM, "select public.desfazer_movimentos($1, 'lançado em dobro')", [n]);
assert.deepEqual(await estoque(), { 1: 14, 2: 8 }, "desfeito: a avaria volta ao estoque");
for (const id of n)
  await as(
    ADM,
    "select public.editar_movimento(id, quantidade_anterior, comentario, 'estava certo') from public.estoque_movimentos where id = $1",
    [id],
  );
assert.deepEqual(await estoque(), { 1: 13, 2: 6 }, "refeito");
assert.match(
  (await db.query("select descricao from public.eventos where tipo = 'edicao_movimento' order by id desc limit 1")).rows[0]
    .descricao,
  /Estragou de P2 .*refeita \(2\). Justificativa: estava certo/,
);

// contagem (qualquer membro): snapshot do período calculado no banco
await db.exec("update public.produtos set estoque_minimo = 7 where id = 2");
await fails(confirmar(VEND, "inventario", [{ produto_id: 1, quantidade: 12 }]), /não bate com o estoque em 1 produto/, "diferença exige explicação");
const [{ n: [contagem] }] = await confirmar(VEND, "inventario", [{ produto_id: 1, quantidade: 12 }], "faltou um na prateleira");
await fails(
  as(VEND, "select public.desfazer_movimentos(array[$1::bigint], 'contei errado')", [contagem]),
  /Contagem não se desfaz/,
);
const [inv] = (
  await db.query("select saldo_anterior, entradas, saidas from public.estoque_movimentos where id = $1", [contagem])
).rows;
assert.deepEqual(inv, { saldo_anterior: 10, entradas: 6, saidas: 3 }, "10 + (5 + 1 compras) − (2 amostra + 1 avaria)");
assert.deepEqual(await as(VEND, "select produto_id, estoque, minimo from public.estoque_loja(1) order by produto_id"), [
  { produto_id: 1, estoque: 12, minimo: 0 },
  { produto_id: 2, estoque: 6, minimo: 7 },
]);

// divergência: esperado 13, contado 12 → falta 1; só admin vê e resolve
const div = async () => (await as(ADM, "select esperado, contado, diferenca, resolvido, explicacao from public.divergencias_loja(1)"))[0];
assert.deepEqual(await div(), { esperado: 13, contado: 12, diferenca: -1, resolvido: 0, explicacao: "faltou um na prateleira" });
assert.equal((await as(CHEFE, "select * from public.divergencias_loja(1)")).length, 1, "chefe vê (só leitura)");
assert.equal((await as(VEND, "select * from public.divergencias_loja(1)")).length, 0, "vendedor não vê a lista");
// alerta de pendência: resumo por loja para chefe e acima
const pend = async (uid) =>
  (await as(uid, "select loja, produtos, faltam, sobram, desde is not null as tem_data from public.pendencias_estoque()"));
const umaFalta = [{ loja: "L1", produtos: 1, faltam: 1, sobram: 0, tem_data: true }];
assert.deepEqual(await pend(ADM), umaFalta, "admin vê a pendência");
assert.deepEqual(await pend(CHEFE), umaFalta, "chefe vê a pendência");
assert.deepEqual(await pend(VEND), [], "vendedor não recebe o alerta");
const recuperar = (uid, tipo, qtd, valor, forma, pessoa, com) =>
  as(uid, "select public.registrar_recuperacao($1, $2, $3, $4, $5::smallint, $6, $7) id", [
    contagem, tipo, qtd, valor, forma, pessoa, com,
  ]);
await fails(recuperar(CHEFE, "produto", 1, null, null, null, null), /Só a administração/);
await fails(recuperar(ADM, "valor", 2, 120, 2, VEND, null), /diferença pendente \(1\)/);
await fails(recuperar(ADM, "valor", 1, 60, null, VEND, null), /forma de pagamento/);
await fails(recuperar(ADM, "acerto", 1, null, null, VEND, null), /Comentário: campo obrigatório/);
const [{ id: recProduto }] = await recuperar(ADM, "produto", 1, null, null, null, null);
assert.deepEqual(await estoque(), { 1: 13, 2: 6 }, "produto recuperado volta ao estoque");
assert.equal((await div()).resolvido, 1);
await fails(recuperar(ADM, "valor", 1, 60, 2, VEND, null), /diferença pendente \(0\)/);
await fails(as(CHEFE, "select public.desfazer_recuperacao($1, 'foi engano')", [recProduto]), /Só a administração/);
await as(ADM, "select public.desfazer_recuperacao($1, 'o produto não tinha voltado')", [recProduto]);
assert.deepEqual(await estoque(), { 1: 12, 2: 6 }, "recuperação desfeita sai do estoque");
await recuperar(ADM, "valor", 1, 60, 2, VEND, "descontado do vendedor");
assert.deepEqual(await pend(ADM), [], "resolvida: alerta some");
assert.deepEqual(await estoque(), { 1: 12, 2: 6 }, "valor cobrado não mexe no estoque");
const caixa = async (uid, de = hoje, ate = hoje) =>
  (await as(uid, "select public.relatorio_caixa(1, $1, $2) r", [de, ate]))[0].r;
const [recAdm] = (await caixa(ADM)).recuperacoes;
assert.deepEqual(
  { ...recAdm, id: undefined, created_at: undefined },
  { id: undefined, created_at: undefined, tipo: "valor", forma: 2, valor: 60, quantidade: 1, produto: "P1", pessoa: "Vend" },
);
const [recChefe] = (await caixa(CHEFE)).recuperacoes;
assert.equal(recChefe.valor, 60, "chefe vê o valor que entrou no caixa");
assert.equal(recChefe.pessoa, null, "mas não de quem");
assert.deepEqual((await caixa(VEND)).recuperacoes, [], "vendedor não vê recuperados");
assert.deepEqual((await caixa(CHEFE, ontem, hoje)).recuperacoes, [], "chefe: só hoje");

// validação de texto no banco (mesma regra do app)
await fails(as(ADM, "insert into public.produtos (loja_id, nome, preco) values (1, '  ab  ', 10)"), /Nome: escreva ao menos 3 letras/);
await fails(as(ADM, "insert into public.produtos (loja_id, nome, preco) values (1, '   ', 10)"), /Nome: campo obrigatório/);
await fails(as(ADM, "insert into public.produtos (loja_id, nome, preco) values (1, '. . .', 10)"), /3 letras/);
await fails(
  as(ADM, `insert into public.produtos (loja_id, nome, preco) values (1, '${"x".repeat(81)}', 10)`),
  /no máximo 80/,
);
const [novo] = await as(
  ADM,
  "insert into public.produtos (loja_id, nome, descricao, preco) values (1, '  Âmbar   Noir ', '   ', 10) returning nome, descricao",
);
assert.deepEqual(novo, { nome: "Âmbar Noir", descricao: null }, "espaços juntados; opcional vazio vira null");
await fails(
  as(CHEFE, "insert into public.estoque_movimentos (produto_id, tipo, quantidade, comentario) values (1, 'amostra', 1, 'ok')"),
  /Comentário: escreva ao menos 3 letras/,
);
await fails(confirmar(ADM, "avaria", [{ produto_id: 1, quantidade: 1 }], "ok"), /3 letras/);
await as(VEND, `insert into public.pedidos (loja_id, vendedor_id) values (1, '${VEND}')`);
await fails(
  as(VEND, "update public.pedidos set nome = 'Jo' where vendedor_id = $1", [VEND]),
  /Nome: escreva ao menos 3 letras/,
);
// legado: nome curto não trava a edição de outro campo da mesma linha
await as(ADM, "update public.produtos set descricao = 'Nova descrição' where id = 1");
assert.equal((await db.query("select nome from public.produtos where id = 1")).rows[0].nome, "P1");
await fails(as(ADM, "update public.produtos set nome = 'P9' where id = 1"), /3 letras/, "mas trocar o nome exige a regra");
await fails(db.query("update public.lojas set nome = 'L' where id = 1"), /Nome da loja/);

// troca de vendedor só para ativos
const INAT = "00000000-0000-0000-0000-000000000051";
await db.exec(`
  set session_replication_role = replica;
  insert into auth.users values ('${INAT}');
  insert into public.profiles (id, nome, usuario, role, ativo) values ('${INAT}', 'Inativo', 'inativo', 50, false);
  insert into public.loja_membros (loja_id, user_id) values (1, '${INAT}');
  set session_replication_role = origin;
`);
const [{ id: vendaOk }] = (await db.query("select id from public.vendas where not anulada limit 1")).rows;
await fails(as(CHEFE, "select public.trocar_vendedor($1, $2)", [vendaOk, INAT]), /inativo/);

// lojas: admin geral (100) cria e vira membro; vendedor/chefe não
await fails(as(CHEFE, "select public.criar_loja('Loja Nova')"), /Só a administração/);
const [{ id: lojaNova }] = await as(ADM, "select public.criar_loja('Loja Nova') id");
assert.equal((await as(ADM, "select id from public.lojas where id = $1", [lojaNova])).length, 1, "admin enxerga a loja que criou");

// metas: só admin define; a da loja vale para todos, a individual por cima
const meta = (uid, min, med, full) =>
  as(uid, "insert into public.metas (loja_id, user_id, meta_minima, meta_media, meta_full) values (1, $1, $2, $3, $4)", [
    VEND, min, med, full,
  ]);
await fails(meta(CHEFE, 5, 10, 20), /row-level security/, "chefe não define metas");
await fails(meta(ADM, 10, 5, 20), /check constraint/);
await meta(ADM, 5, 10, 20);
const metaLoja = (uid) =>
  as(uid, "insert into public.metas_loja (loja_id, meta_minima, meta_media, meta_maxima) values (1, 2, 4, 8)");
await fails(metaLoja(CHEFE), /row-level security/);
await metaLoja(ADM);
const ranking = async () =>
  (await as(VEND, "select nome, combos, vendas, meta_full, meta_individual from public.ranking_vendedores(1, $1, $1)", [hoje])).map(
    (r) => [r.nome, Number(r.combos), r.vendas, r.meta_full && Number(r.meta_full), r.meta_individual],
  );
assert.deepEqual(
  await ranking(),
  [
    ["Chefe", 1, 1, 8, false],
    ["Vend", 0, 0, 20, true],
  ],
  "venda anulada não conta; admin e inativo fora; meta da loja para quem não tem individual",
);

// devolução no caixa: vendedor e admin (chefe não); produto e/ou valor, escolhido na hora
const [{ id: ped }] = await as(VEND, `insert into public.pedidos (loja_id, vendedor_id) values (1, '${VEND}') on conflict do nothing returning id`)
  .then((r) => (r.length ? r : as(VEND, "select id from public.pedidos where nome is null and vendedor_id = $1", [VEND])));
await as(VEND, "insert into public.pedido_itens (pedido_id, produto_id, preco, quantidade) values ($1, 2, 10, 3)", [ped]);
const [{ v: vendaDev }] = await as(VEND, 'select public.finalizar_venda($1, \'[{"forma":1,"valor":30}]\') v', [ped]);
assert.deepEqual(await estoque(), { 1: 12, 2: 3 });
const devolver = (uid, itens, volta, valor, forma, motivo = "Cliente não gostou") =>
  as(uid, "select public.registrar_devolucao($1, $2, $3, $4, $5::smallint, $6) d", [
    vendaDev, JSON.stringify(itens), volta, valor, forma, motivo,
  ]);
await fails(devolver(CHEFE, [{ produto_id: 2, quantidade: 1 }], true, true, 1), /Chefe de loja não faz devolução/);
await fails(devolver(VEND, [{ produto_id: 2, quantidade: 4 }], true, true, 1), /maior do que a vendida/);
await fails(devolver(VEND, [{ produto_id: 1, quantidade: 1 }], true, true, 1), /maior do que a vendida/, "produto fora da venda");
await fails(devolver(VEND, [{ produto_id: 2, quantidade: 1 }], false, false, null), /Escolha o que fazer/);
await fails(devolver(VEND, [{ produto_id: 2, quantidade: 1 }], true, true, null), /como o valor foi devolvido/);
await fails(devolver(VEND, [{ produto_id: 2, quantidade: 1 }], true, true, 1, " "), /Motivo: campo obrigatório/);
assert.equal(
  (await as(CHEFE, "select public.venda_para_devolucao(1, $1) v", [vendaDev]))[0].v,
  null,
  "chefe não abre a devolução",
);
const [{ d: dev }] = await devolver(VEND, [{ produto_id: 2, quantidade: 1 }], true, true, 1);
assert.deepEqual(await estoque(), { 1: 12, 2: 4 }, "produto devolvido volta ao estoque");
const [{ v: paraDev }] = await as(VEND, "select public.venda_para_devolucao(1, $1) v", [vendaDev]);
assert.deepEqual(
  paraDev.itens.map((i) => [i.nome, i.vendido, i.devolvido, i.preco]),
  [["P2", 3, 1, 10]],
);
const [devCaixa] = (await caixa(VEND)).devolucoes;
assert.equal(devCaixa.valor, 10);
assert.equal(devCaixa.forma, 1);
assert.equal(devCaixa.desfeita, false);
assert.equal(Number((await rel(VEND, hoje, hoje)).find((v) => v.id === vendaDev).devolvido), 10);
assert.deepEqual((await ranking()).find((r) => r[0] === "Vend"), ["Vend", 2, 1, 20, true], "devolução com valor tira os combos");
// só o produto (troca, sem dinheiro): estoque volta, combos e caixa ficam
await devolver(ADM, [{ produto_id: 2, quantidade: 1 }], true, false, null, "Troca por outro tamanho");
assert.deepEqual(await estoque(), { 1: 12, 2: 5 });
assert.deepEqual((await ranking()).find((r) => r[0] === "Vend"), ["Vend", 2, 1, 20, true]);
await fails(devolver(VEND, [{ produto_id: 2, quantidade: 2 }], true, true, 1), /já devolvida/);
// venda com devolução não se anula nem se edita
await fails(as(CHEFE, "select public.anular_venda($1, 'Cliente desistiu')", [vendaDev]), /devolução registrada/);
await fails(
  as(CHEFE, 'select public.editar_venda($1, \'[{"produto_id":2,"preco":10,"quantidade":1}]\', \'[{"forma":1,"valor":10}]\')', [vendaDev]),
  /devolução registrada/,
);
await fails(as(VEND, "select public.desfazer_devolucao($1, 'registrei errado')", [dev]), /Só a administração/);
await as(ADM, "select public.desfazer_devolucao($1, 'registrada na venda errada')", [dev]);
assert.deepEqual(await estoque(), { 1: 12, 2: 4 }, "devolução desfeita: o produto sai de novo");
assert.deepEqual((await ranking()).find((r) => r[0] === "Vend"), ["Vend", 3, 1, 20, true], "e os combos voltam");
assert.equal((await caixa(VEND)).devolucoes.find((d) => d.id === dev).desfeita, true);
assert.match(
  (await db.query("select descricao from public.eventos where tipo = 'devolucao' order by id limit 1")).rows[0].descricao,
  /Devolução na venda .* 1× P2\. Produto voltou ao estoque\. Valor devolvido: 10\.00 \(forma 1\)\. Motivo: Cliente não gostou/,
);

// histórico e auditoria: só administração
assert.equal((await as(CHEFE, "select * from public.eventos")).length, 0, "chefe não vê o histórico");
assert.equal((await as(CHEFE, "select * from public.auditoria")).length, 0, "nem a auditoria");
assert.ok((await as(ADM, "select * from public.eventos where loja_id = 1")).length > 5, "eventos com loja");
const [aud] = await as(
  ADM,
  "select user_id, loja_id, antes, depois from public.auditoria where tabela = 'estoque_movimentos' and acao = 'UPDATE' and registro_id = $1 order by id limit 1",
  [String(amostraChefe)],
);
assert.equal(aud.user_id, CHEFE, "auditoria guarda quem");
assert.equal(aud.loja_id, 1);
assert.equal(aud.antes.quantidade, 1);
assert.equal(aud.depois.quantidade, 2);
assert.ok(!("produto_id" in aud.depois), "no UPDATE, só o que mudou");
assert.ok(
  (await as(ADM, "select 1 from public.auditoria where tabela = 'devolucoes' and acao = 'INSERT'")).length >= 2,
  "devoluções auditadas",
);

// contagem com sobra: também exige explicação e fica pendente; só se resolve aceitando a diferença
const [{ estoque: p2 }] = await as(ADM, "select estoque from public.estoque_loja(1) where produto_id = 2");
await confirmar(VEND, "inventario", [{ produto_id: 2, quantidade: p2 }]); // bateu: sem explicação
await fails(confirmar(VEND, "inventario", [{ produto_id: 2, quantidade: p2 + 1 }]), /não bate com o estoque/);
const [{ n: [sobra] }] = await confirmar(VEND, "inventario", [{ produto_id: 2, quantidade: p2 + 1 }], "achei um no depósito");
const divSobra = async () =>
  (await as(ADM, "select diferenca, resolvido from public.divergencias_loja(1) where movimento_id = $1", [sobra]))[0];
assert.deepEqual(await divSobra(), { diferenca: 1, resolvido: 0 }, "sobra fica pendente");
assert.deepEqual(await pend(CHEFE), [{ loja: "L1", produtos: 1, faltam: 0, sobram: 1, tem_data: true }], "sobra também alerta");
const recSobra = (tipo, com) =>
  as(ADM, "select public.registrar_recuperacao($1, $2, 1, $3, $4::smallint, null, $5)", [
    sobra, tipo, tipo === "valor" ? 10 : null, tipo === "valor" ? 2 : null, com,
  ]);
await fails(recSobra("valor", null), /só dá para aceitar/);
await fails(recSobra("produto", null), /só dá para aceitar/);
await recSobra("acerto", "venda feita no papel e não lançada");
assert.deepEqual(await divSobra(), { diferenca: 1, resolvido: 1 }, "sobra resolvida");
assert.deepEqual(await pend(CHEFE), [], "sem pendências");

console.log("todos os testes passaram");
