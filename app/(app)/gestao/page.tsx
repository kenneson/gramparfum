import { requireRole } from "@/lib/session";
import { Gestao } from "./gestao";

export default async function GestaoPage() {
  await requireRole(90);
  return <Gestao />;
}
