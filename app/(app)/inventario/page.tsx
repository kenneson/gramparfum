import { requireRole } from "@/lib/session";
import { Inventario } from "./inventario";

export default async function InventarioPage() {
  await requireRole(50); // vendedor e chefe: só amostras (a tela e o banco restringem o resto)
  return <Inventario />;
}
