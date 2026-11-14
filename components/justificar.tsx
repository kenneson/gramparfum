"use client";

import { useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { MAX_TEXTO, campoTexto } from "@/lib/texto";
import { Button, Field, Modal, Textarea } from "@/components/ui";

// Toda remoção/correção pede o porquê (fica no Histórico com o nome de quem fez).
// onConfirmar devolve true quando deu certo (aí o modal fecha).
export function Justificar({
  titulo,
  aviso,
  botao = "Confirmar",
  onClose,
  onConfirmar,
}: {
  titulo: string;
  aviso: ReactNode;
  botao?: string;
  onClose: () => void;
  onConfirmar: (motivo: string) => Promise<boolean>;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const m = campoTexto(motivo, "Justificativa", { obrigatorio: true });
    if (m.erro) return toast.error(m.erro);
    setEnviando(true);
    const ok = await onConfirmar(m.valor!);
    setEnviando(false);
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={titulo}>
      <form className="flex flex-col gap-4" onSubmit={enviar}>
        <div className="text-sm text-muted">{aviso}</div>
        <Field label="Justificativa (obrigatória)">
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={MAX_TEXTO}
            required
            autoFocus
            placeholder="Ex.: lancei o perfume errado"
          />
        </Field>
        <p className="text-xs text-muted">Fica registrado no Histórico com o seu nome.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" variant="danger" disabled={enviando}>
            {enviando && <LoaderCircle size={16} className="animate-spin" />}
            {botao}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
