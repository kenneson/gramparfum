"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Boxes,
  History,
  LogOut,
  ShoppingBag,
  Store,
  Trophy,
  Users,
} from "lucide-react";
import { logout, setIdioma } from "@/app/actions";
import {
  dict,
  LOJA_COOKIE,
  ROLES,
  type Dict,
  type Idioma,
  type Loja,
  type Profile,
} from "@/lib/domain";
import { Avatar, cx } from "@/components/ui";

type Ctx = {
  profile: Profile;
  lojas: Loja[];
  lojaId: number | null;
  idioma: Idioma;
  t: Dict;
};
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
  const lojaId = lojas.some((l) => l.id === escolhida)
    ? escolhida
    : (lojas[0]?.id ?? null);
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
    { href: "/ranking", label: t.ranking, icon: Trophy, min: 50 },
    { href: "/gestao", label: t.gestao, icon: Users, min: 90 },
    { href: "/inventario", label: t.inventario, icon: Boxes, min: 50 },
    { href: "/historico", label: t.historico, icon: History, min: 90 },
  ].filter((n) => profile.role >= n.min);

  const seletorLoja = (escuro: boolean) => (
    <label
      className={cx(
        "flex h-11 min-w-0 items-center gap-2 rounded-xl border pr-1 pl-3",
        escuro
          ? "border-side-line bg-side-2 text-white"
          : "border-line bg-card shadow-card",
      )}
    >
      <Store
        size={16}
        className={cx("shrink-0", escuro ? "text-side-muted" : "text-gold")}
      />
      <span className="sr-only">{t.loja}</span>
      <select
        value={lojaId ?? ""}
        onChange={(e) => escolherLoja(Number(e.target.value))}
        className="h-full min-w-0 flex-1 cursor-pointer bg-transparent pr-2 text-base font-semibold focus:outline-none sm:text-sm"
      >
        {lojas.length === 0 && <option value="">Sem loja associada</option>}
        {lojas.map((l) => (
          <option key={l.id} value={l.id} className="text-ink">
            {l.nome}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <AppCtx.Provider value={{ profile, lojas, lojaId, idioma, t }}>
      {/* celular: barra embaixo · celular deitado e tablet (md): trilho de ícones · desktop (xl): barra lateral completa.
          Laterais com env(safe-area-inset-*): deitado, o notch/ilha fica de um dos lados. */}
      <div className="pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:pl-[calc(5.5rem+env(safe-area-inset-left))] deitado:pl-[calc(5.5rem+env(safe-area-inset-left))] xl:pl-60">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[calc(5.5rem+env(safe-area-inset-left))] flex-col gap-5 overflow-y-auto bg-side pt-[max(1.25rem,env(safe-area-inset-top))] pr-2 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[calc(0.5rem+env(safe-area-inset-left))] text-side-text md:flex deitado:flex deitado:gap-2 deitado:pt-2 xl:w-60 xl:px-3.5">
          <div className="flex items-center justify-center gap-3 deitado:hidden xl:justify-start xl:px-2">
            <Image
              src="/logo.png"
              alt="GamParfum"
              width={652}
              height={634}
              className="w-9 shrink-0"
            />
            <span className="hidden flex-col xl:flex">
              <span className="text-[17px] font-bold tracking-tight text-white">
                GamParfum
              </span>
              <span className="text-xs text-side-muted">Sistema de vendas</span>
            </span>
          </div>

          <div className="hidden xl:block">{seletorLoja(true)}</div>

          <nav aria-label="Principal" className="flex flex-col gap-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] font-semibold transition-colors deitado:gap-0.5 deitado:py-1.5 xl:h-11 xl:flex-row xl:gap-3 xl:px-3 xl:py-0 xl:text-sm",
                    active
                      ? "bg-side-active text-white"
                      : "text-side-text hover:bg-side-2 hover:text-white",
                  )}
                >
                  <Icon
                    size={20}
                    strokeWidth={active ? 2.25 : 1.75}
                    className={cx("shrink-0", active && "text-gold-bright")}
                  />
                  <span className="max-w-full truncate px-1 xl:px-0">
                    {label}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* deitado: idioma e sair ficam no topo (sobra altura para o menu) */}
          <div className="mt-auto flex flex-col items-center gap-2 border-t border-side-line pt-3 deitado:hidden xl:flex-row xl:px-1">
            <span title={`${profile.nome} · ${ROLES[profile.role]}`}>
              <Avatar nome={profile.nome} size={36} dark />
            </span>
            <span className="hidden min-w-0 flex-1 flex-col xl:flex">
              <span className="truncate text-sm font-semibold text-white">
                {profile.nome}
              </span>
              <span className="truncate text-xs text-side-muted">
                {ROLES[profile.role]}
              </span>
            </span>
            <IdiomaBtn idioma={idioma} onClick={trocarIdioma} />
            <form action={logout}>
              <button
                aria-label={t.sair}
                title={t.sair}
                className="grid size-11 place-items-center rounded-xl text-side-muted transition hover:bg-side-2 hover:text-white active:scale-95"
              >
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </aside>

        {/* Topo (celular e tablet): loja, idioma e sair */}
        <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 xl:hidden">
          <div className="flex h-14 items-center gap-2.5 px-4 md:px-6">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-side md:hidden">
              <Image
                src="/logo.png"
                alt="GamParfum"
                width={652}
                height={634}
                className="w-6"
              />
            </span>
            <div className="min-w-0 flex-1 sm:max-w-xs sm:flex-none">
              {seletorLoja(false)}
            </div>
            <div className="ml-auto flex shrink-0 items-center md:hidden deitado:flex">
              <IdiomaBtn idioma={idioma} onClick={trocarIdioma} light />
              <form action={logout}>
                <button
                  aria-label={t.sair}
                  className="grid size-11 place-items-center rounded-xl text-muted transition hover:bg-ink/5 active:scale-95 active:bg-ink/5"
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
          className="mx-auto max-w-[1440px] px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-6 md:px-6 md:pb-10 deitado:pt-4 deitado:pb-10 xl:px-10 xl:pt-8"
        >
          {children}
        </main>

        {/* Navegação no celular */}
        <nav
          aria-label="Principal"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden deitado:hidden"
        >
          <div className="flex px-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                    active ? "font-bold text-ink" : "font-medium text-muted",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-7 w-14 place-items-center rounded-full transition group-active:scale-90",
                      active
                        ? "bg-gold-soft text-gold-ink"
                        : "group-active:bg-ink/5",
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

function IdiomaBtn({
  idioma,
  onClick,
  light,
}: {
  idioma: Idioma;
  onClick: () => void;
  light?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        idioma === "pt"
          ? "Português — trocar para Español"
          : "Español — cambiar a Português"
      }
      className={cx(
        "grid size-11 place-items-center rounded-xl transition active:scale-95",
        light ? "hover:bg-ink/5" : "hover:bg-side-2",
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
      Nenhuma loja associada ao seu usuário. Peça ao administrador para
      associá-lo a uma loja.
    </div>
  );
}
