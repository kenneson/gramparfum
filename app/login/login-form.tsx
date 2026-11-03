"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { login } from "@/app/actions";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm() {
  const [erro, action, pending] = useActionState(login, null);
  const [verSenha, setVerSenha] = useState(false);
  return (
    <form action={action} className="mt-8 flex flex-col gap-5">
      <Field label="Usuário">
        <Input
          name="usuario"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="@usuario"
          required
          autoFocus
        />
      </Field>
      <Field label="Senha">
        <div className="relative">
          <Input
            name="senha"
            type={verSenha ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            required
            className="pr-12"
          />
          <button
            type="button"
            onClick={() => setVerSenha((v) => !v)}
            // mantém o foco no campo: no celular o teclado não fecha ao tocar no olho
            onPointerDown={(e) => e.preventDefault()}
            aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={verSenha}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-muted transition hover:text-ink active:scale-90"
          >
            {verSenha ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </Field>
      {erro && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {erro}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="mt-2">
        {pending && <LoaderCircle size={18} className="animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}
