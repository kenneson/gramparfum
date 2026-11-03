export type Pag = { forma: number; valor: number; comentario?: string };

const DINHEIRO = 2;
const cents = (v: number) => Math.round(v * 100);

// Mesmas regras de public.finalizar_venda: paga tudo, e troco só sai de dinheiro
export function resumo(total: number, pagamentos: Pag[]) {
  const t = cents(total);
  const pago = pagamentos.reduce((s, p) => s + cents(p.valor), 0);
  const dinheiro = pagamentos.filter((p) => p.forma === DINHEIRO).reduce((s, p) => s + cents(p.valor), 0);
  const troco = Math.max(0, pago - t);
  const erro = troco > dinheiro ? "O troco só pode sair de pagamento em dinheiro" : null;
  return {
    pago: pago / 100,
    restante: Math.max(0, t - pago) / 100,
    troco: troco / 100,
    erro,
    ok: pago >= t && !erro,
  };
}
