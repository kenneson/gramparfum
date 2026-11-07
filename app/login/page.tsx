import type { Viewport } from "next";
import Image from "next/image";
import { LoginForm } from "./login-form";

// topo da tela de login é escuro: barra de status acompanha
export const viewport: Viewport = { themeColor: "#16130f" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { erro } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative flex flex-col items-center justify-center overflow-hidden bg-ink px-8 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-12 text-center text-white lg:py-0">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_40%,rgba(242,223,87,0.16),transparent_70%)]"
        />
        <Image
          src="/logo.png"
          alt="GamParfum"
          width={652}
          height={634}
          priority
          className="relative w-28 sm:w-40 lg:w-64"
        />
        <p className="relative mt-6 max-w-sm font-display text-xl text-white/80 sm:mt-8 sm:text-2xl lg:text-3xl">
          O mundo das fragrâncias, na palma do caixa.
        </p>
      </section>

      <section className="relative -mt-6 flex items-start justify-center rounded-t-[1.75rem] bg-paper px-6 pt-10 pb-[calc(3rem+env(safe-area-inset-bottom))] lg:mt-0 lg:items-center lg:rounded-none lg:py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-4xl font-semibold">Entrar</h1>
          <p className="mt-2 text-sm text-muted">Acesse com o usuário fornecido pelo administrador.</p>
          {erro === "inativo" && (
            <p className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">Usuário inativo.</p>
          )}
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
