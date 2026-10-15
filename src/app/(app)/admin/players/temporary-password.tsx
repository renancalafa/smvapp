"use client";

import { useState } from "react";

/** Mostra a senha temporária uma única vez: ela não é guardada nem pode ser consultada depois. */
export function TemporaryPassword({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-medium">Senha temporária de {username}</p>
      <p className="mt-2 select-all rounded-lg bg-white px-3 py-3 text-center font-mono text-xl tracking-wider text-zinc-900">
        {password}
      </p>
      <button
        type="button"
        onClick={copy}
        className="mt-2 min-h-11 w-full rounded-lg border border-amber-300 bg-white font-medium active:bg-amber-100"
      >
        {copied ? "Copiada" : "Copiar senha"}
      </button>
      <p className="mt-2">
        Anote ou envie agora: ela não será mostrada de novo. No primeiro login, o jogador terá de criar uma
        senha nova.
      </p>
    </div>
  );
}
