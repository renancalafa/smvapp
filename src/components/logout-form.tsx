"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { unsubscribeCurrentDevice } from "@/lib/pwa/push-client";
import { logoutAction } from "@/server/auth/actions";

/**
 * "Sair" explícito: antes de encerrar a sessão, cancela o push deste aparelho e manda o
 * endpoint para o servidor apagar. Outros aparelhos não são afetados. Sem JavaScript, ou se a
 * limpeza falhar, o logout acontece do mesmo jeito.
 */
export function LogoutForm({
  className,
  buttonClassName,
  children = "Sair",
}: {
  className?: string;
  buttonClassName: string;
  children?: ReactNode;
}) {
  const cleaned = useRef(false);
  const endpointInput = useRef<HTMLInputElement>(null);
  const [leaving, setLeaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (cleaned.current) return;
    event.preventDefault();
    if (leaving) return;
    setLeaving(true);
    const form = event.currentTarget;
    const endpoint = await unsubscribeCurrentDevice();
    if (endpointInput.current) endpointInput.current.value = endpoint;
    cleaned.current = true;
    form.requestSubmit();
  }

  return (
    <form action={logoutAction} onSubmit={handleSubmit} className={className}>
      <input ref={endpointInput} type="hidden" name="pushEndpoint" defaultValue="" />
      <button type="submit" disabled={leaving} className={buttonClassName}>
        {leaving ? "Saindo…" : children}
      </button>
    </form>
  );
}
