import { requireRole } from "@/lib/session";
import { Inventario } from "./inventario";

export default async function InventarioPage() {
  await requireRole(90);
  return <Inventario />;
}
