"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Boxes, History, LogOut, ShoppingBag, Store, Users } from "lucide-react";
import { logout, setIdioma } from "@/app/actions";
import { dict, LOJA_COOKIE, ROLES, type Dict, type Idioma, type Loja, type Profile } from "@/lib/domain";
import { Avatar, cx } from "@/components/ui";

type Ctx = { profile: Profile; lojas: Loja[]; lojaId: number | null; idioma: Idioma; t: Dict };
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function Shell({
  profile,
  lojas,
  lojaInicial,
  children,
}: {
  profile: Profile;
  lojas: Loja[];
  lojaInicial: number | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [escolhida, setEscolhida] = useState(lojaInicial);
  // loja lembrada em cookie (conveniência; a autorização é RLS). Se sumiu da lista, cai na primeira.
  const lojaId = lojas.some((l) => l.id === escolhida) ? escolhida : (lojas[0]?.id ?? null);
  const [, startTransition] = useTransition();
  const idioma = profile.idioma;
  const t = dict(idioma);

  const escolherLoja = (id: number) => {
    setEscolhida(id);
    document.cookie = `${LOJA_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
  };

  const trocarIdioma = () =>
    startTransition(async () => {
      await setIdioma(idioma === "pt" ? "es" : "pt");
      router.refresh();
    });

  const nav = [
    { href: "/caixa", label: t.caixa, icon: ShoppingBag, min: 50 },
    { href: "/relatorios", label: t.relatorios, icon: BarChart3, min: 50 },
    { href: "/gestao", label: t.gestao, icon: Users, min: 90 },
    { href: "/inventario", label: t.inventario, icon: Boxes, min: 50 },
    { href: "/historico", label: t.historico, icon: History, min: 90 },
  ].filter((n) => profile.role >= n.min);

  return (
    <AppCtx.Provider value={{ profile, lojas, lojaId, idioma, t }}>
      <div className="lg:pl-64">
        {/* Sidebar desktop */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink text-white lg:flex">
          <div className="flex items-center gap-3 px-6 pt-7 pb-8">
            <Image src="/logo.png" alt="" width={652} height={634} className="w-10" />
            <span className="font-display text-2xl font-semibold tracking-wide text-gold-bright">GamParfum</span>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cx(
                    "group relative flex h-11 items-center gap-3 rounded-xl px-4 text-sm font-semibold transition",
                    active
                      ? "bg-linear-to-r from-white/12 to-white/[0.04] text-white"
                      : "text-white/55 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-1 rounded-r bg-gold-bright" />}
                  <Icon size={18} className={active ? "text-gold-bright" : ""} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="m-3 rounded-2xl bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <Avatar nome={profile.nome} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{profile.nome}</div>
                <div className="truncate text-xs text-white/50">{ROLES[profile.role]}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <IdiomaBtn idioma={idioma} onClick={trocarIdioma} />
              <form action={logout} className="flex-1">
                <button className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold text-white/60 transition hover:bg-white/10 hover:text-white">
                  <LogOut size={14} /> {t.sair}
                </button>
              </form>
            </div>
          </div>
        </aside>

        {/* Topo */}
        <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
          <div className="flex h-14 items-center gap-2.5 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] lg:h-16 lg:px-8">
            <Image src="/icon-ticket.png" alt="GamParfum" width={139} height={135} className="w-8 shrink-0 lg:hidden" />
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/80 bg-card pr-1 pl-3 shadow-card sm:flex-none lg:ml-auto">
              <Store size={16} className="shrink-0 text-gold" />
              <span className="sr-only">{t.loja}</span>
              <select
                value={lojaId ?? ""}
                onChange={(e) => escolherLoja(Number(e.target.value))}
                className="h-full min-w-0 flex-1 cursor-pointer bg-transparent pr-2 text-base font-semibold focus:outline-none sm:text-sm"
              >
                {lojas.length === 0 && <option value="">Sem loja associada</option>}
                {lojas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex shrink-0 items-center sm:ml-auto lg:hidden">
              <IdiomaBtn idioma={idioma} onClick={trocarIdioma} light />
              <form action={logout}>
                <button
                  aria-label={t.sair}
                  className="grid size-10 place-items-center rounded-xl text-muted transition hover:bg-ink/5 active:scale-95 active:bg-ink/5"
                >
                  <LogOut size={18} />
                </button>
              </form>
            </div>
          </div>
        </header>

        {/* key: trocar de loja remonta a tela, zerando estado da loja anterior */}
        <main
          key={lojaId}
          className="mx-auto max-w-[1400px] px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-6 lg:px-8 lg:pb-12"
        >
          {children}
        </main>

        {/* Navegação mobile */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
          <div className="flex px-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
                    active ? "text-gold-bright" : "text-white/55",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-7 w-14 place-items-center rounded-full transition group-active:scale-90",
                      active ? "bg-gold-bright/15" : "group-active:bg-white/10",
                    )}
                  >
                    <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                  </span>
                  <span className="max-w-full truncate px-0.5">{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </AppCtx.Provider>
  );
}

function IdiomaBtn({ idioma, onClick, light }: { idioma: Idioma; onClick: () => void; light?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={idioma === "pt" ? "Português — trocar para Español" : "Español — cambiar a Português"}
      className={cx(
        "grid size-10 place-items-center rounded-xl transition active:scale-95 lg:size-9 lg:rounded-lg",
        light ? "hover:bg-ink/5" : "hover:bg-white/10",
      )}
    >
      <Image
        src={idioma === "pt" ? "/brasil.png" : "/bolivia.png"}
        alt={idioma}
        width={22}
        height={22}
        className="rounded-full"
      />
    </button>
  );
}

export function SemLoja() {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center text-muted">
      Nenhuma loja associada ao seu usuário. Peça ao administrador para associá-lo a uma loja.
    </div>
  );
}
