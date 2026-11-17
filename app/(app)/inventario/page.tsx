import { requireRole } from "@/lib/session";
import { Inventario } from "./inventario";

export default async function InventarioPage({ searchParams }: PageProps<"/inventario">) {
  await requireRole(50); // vendedor e chefe: só amostras (a tela e o banco restringem o resto)
  const { aba } = await searchParams;
  // ?aba=pendencias vem do alerta de divergência; key remonta a tela se já estiver aberta
  const pendencias = aba === "pendencias";
  return <Inventario key={pendencias ? "p" : "i"} abrirPendencias={pendencias} />;
}
