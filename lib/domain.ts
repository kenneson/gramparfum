export type Role = 50 | 90 | 100 | 200;
export const LOJA_COOKIE = "gp_loja";
export type Idioma = "pt" | "es";

export type Profile = {
  id: string;
  nome: string;
  usuario: string;
  role: Role;
  idioma: Idioma;
  descricao: string | null;
  acesso_habilitado: boolean;
  ativo: boolean;
};

export type Loja = { id: number; nome: string; ativo: boolean };

export type Produto = {
  id: number;
  loja_id: number;
  nome: string;
  descricao: string | null;
  preco: number;
  valor_combo: number;
  estoque_minimo: number;
  a_venda: boolean;
  ativo: boolean;
};

export type Estoque = {
  produto_id: number;
  ultimo_inventario: string | null;
  saldo_inventario: number;
  entradas: number;
  amostras: number;
  outras_saidas: number; // doação + estragou
  vendidos: number;
  estoque: number;
  minimo: number;
};

export const ROLES: Record<Role, string> = {
  50: "Vendedor",
  90: "Chefe de loja",
  100: "Admin. geral de lojas",
  200: "Admin. do sistema",
};

export const FORMAS: Record<number, string> = {
  1: "Pix",
  2: "Dinheiro",
  3: "Cartão crédito",
  4: "Cartão débito",
  5: "Link pagamento",
};

// Login é por usuário; o Supabase Auth exige e-mail, então mapeamos para um e-mail sintético.
export const usuarioToEmail = (usuario: string) =>
  `${normalizarUsuario(usuario)}@gamparfum.local`;
export const normalizarUsuario = (u: string) =>
  u.trim().replace(/^@/, "").toLowerCase();

const MOEDA: Record<Idioma, { simbolo: string; locale: string }> = {
  pt: { simbolo: "R$", locale: "pt-BR" },
  es: { simbolo: "Bs.", locale: "es-BO" },
};

export function money(
  v: number | string | null | undefined,
  idioma: Idioma = "pt",
) {
  const { simbolo, locale } = MOEDA[idioma];
  return `${simbolo} ${Number(v ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const num = (v: number | string | null | undefined, decimals = 0) =>
  Number(v ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const TZ = "America/Sao_Paulo";

export const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: TZ,
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

export const hojeISO = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: TZ });

// Dia inteiro (AAAA-MM-DD) no fuso de São Paulo, para filtrar timestamptz
export const intervaloDia = (dia: string) => ({
  de: `${dia}T00:00:00-03:00`,
  ate: `${dia}T23:59:59.999-03:00`,
});

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });

export function diasDesde(iso: string | null) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
}

export const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

// ponytail: i18n só nas telas de operação (como o legado); demais telas em PT
const T = {
  pt: {
    caixa: "Caixa",
    relatorios: "Relatórios",
    gestao: "Gestão",
    inventario: "Inventário",
    historico: "Histórico",
    sair: "Sair",
    loja: "Loja",
    buscar: "Buscar produto…",
    vendedor: "Vendedor",
    pedidoAtual: "Pedido atual",
    detalheVenda: "Detalhe da venda",
    vazio: "Toque em um produto para começar a venda",
    subtotal: "Subtotal",
    total: "Total",
    cobrar: "Cobrar",
    salvar: "Salvar pedido",
    efetuarPagamento: "Efetuar pagamento",
    valorReceber: "Valor a receber",
    troco: "Troco",
    falta: "Falta",
    adicionar: "Adicionar",
    finalizar: "Finalizar venda",
    comentario: "Comentário",
    estoque: "Estoque",
  },
  es: {
    caixa: "Caja",
    relatorios: "Informes",
    gestao: "Gestión",
    inventario: "Inventario",
    historico: "Historial",
    sair: "Salir",
    loja: "Tienda",
    buscar: "Buscar producto…",
    vendedor: "Vendedor",
    pedidoAtual: "Pedido actual",
    detalheVenda: "Detalle de venta",
    vazio: "Toque un producto para empezar la venta",
    subtotal: "Subtotal",
    total: "Total",
    cobrar: "Cobrar",
    salvar: "Guardar pedido",
    efetuarPagamento: "Efectuar pago",
    valorReceber: "Valor a recibir",
    troco: "Cambio",
    falta: "Falta",
    adicionar: "Agregar",
    finalizar: "Finalizar venta",
    comentario: "Comentario",
    estoque: "Stock",
  },
} as const;

export type Dict = Record<keyof (typeof T)["pt"], string>;
export const dict = (idioma: Idioma): Dict => T[idioma];
