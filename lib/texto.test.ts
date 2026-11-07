// node --test lib/texto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { campoTexto, limpar, validar } from "./texto.ts";

test("limpar junta espaços, tira invisíveis e corta as pontas", () => {
  assert.equal(limpar("  Âmbar \n\t Noir​  "), "Âmbar Noir");
  assert.equal(limpar(null), "");
});

test("obrigatório: vazio, só espaços e menos de 3 letras são recusados", () => {
  assert.match(
    campoTexto("", "Nome", { obrigatorio: true }).erro!,
    /obrigatório/,
  );
  assert.match(
    campoTexto("    ", "Nome", { obrigatorio: true }).erro!,
    /obrigatório/,
  );
  assert.match(
    campoTexto("ab", "Nome", { obrigatorio: true }).erro!,
    /3 letras/,
  );
  assert.match(
    campoTexto("a . b", "Nome", { obrigatorio: true }).erro!,
    /3 letras/,
    "pontuação não conta",
  );
  assert.deepEqual(campoTexto("  Ana  ", "Nome", { obrigatorio: true }), {
    valor: "Ana",
    erro: null,
  });
  assert.equal(
    campoTexto("Ñoño", "Nome", { obrigatorio: true }).erro,
    null,
    "acentos contam como letras",
  );
});

test("opcional: vazio vira null; preenchido segue a mesma regra", () => {
  assert.deepEqual(campoTexto("   ", "Comentário"), {
    valor: null,
    erro: null,
  });
  assert.match(campoTexto("ok", "Comentário").erro!, /3 letras/);
  assert.match(
    campoTexto("x".repeat(81), "Nome", { max: 80 }).erro!,
    /no máximo 80/,
  );
});

test("validar devolve o primeiro erro ou os valores limpos", () => {
  assert.deepEqual(
    validar({
      nome: campoTexto(" Loja  Centro ", "Nome", { obrigatorio: true }),
      d: campoTexto("", "D"),
    }),
    {
      erro: null,
      valores: { nome: "Loja Centro", d: null },
    },
  );
  assert.match(
    validar({ nome: campoTexto("x", "Nome", { obrigatorio: true }) }).erro!,
    /^Nome:/,
  );
});
