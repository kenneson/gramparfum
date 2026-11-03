import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { Shell } from "@/components/shell";
import { LOJA_COOKIE } from "@/lib/domain";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [{ profile, lojas }, jar] = await Promise.all([getSession(), cookies()]);
  const lojaInicial = Number(jar.get(LOJA_COOKIE)?.value) || null;
  return (
    <Shell profile={profile} lojas={lojas} lojaInicial={lojaInicial}>
      {children}
    </Shell>
  );
}
