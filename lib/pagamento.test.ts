// node --test lib/pagamento.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumo } from "./pagamento.ts";

test("pagamento exato em pix", () => {
  assert.deepEqual(resumo(150, [{ forma: 1, valor: 150 }]), { pago: 150, restante: 0, troco: 0, erro: null, ok: true });
});

test("falta valor", () => {
  const r = resumo(150, [{ forma: 1, valor: 100 }]);
  assert.equal(r.restante, 50);
  assert.equal(r.ok, false);
});

test("troco em dinheiro", () => {
  const r = resumo(87.5, [{ forma: 2, valor: 100 }]);
  assert.equal(r.troco, 12.5);
  assert.equal(r.ok, true);
});

test("troco maior que o dinheiro recebido é bloqueado", () => {
  const r = resumo(100, [
    { forma: 3, valor: 100 },
    { forma: 2, valor: 5 },
  ]);
  assert.equal(r.troco, 5);
  assert.equal(r.ok, true);
  const r2 = resumo(100, [
    { forma: 3, valor: 110 },
    { forma: 2, valor: 5 },
  ]);
  assert.equal(r2.ok, false);
  assert.ok(r2.erro);
});

test("sem erro de ponto flutuante", () => {
  assert.equal(
    resumo(0.3, [
      { forma: 1, valor: 0.1 },
      { forma: 1, valor: 0.2 },
    ]).ok,
    true,
  );
});
