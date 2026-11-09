"use client";

import { useState } from "react";
import {
  darkAlertWarn,
  darkBtnSecondary,
  darkInset,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";

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
    <div role="status" className={`flex flex-col gap-2 p-4 ${darkAlertWarn}`}>
      <p className={darkTitleMd}>Senha temporária de {username}</p>
      <p
        className={`select-all px-3 py-3 text-center font-mono text-xl tracking-wider text-smv-cream ${darkInset}`}
      >
        {password}
      </p>
      <button type="button" onClick={copy} className={`w-full ${darkBtnSecondary}`}>
        {copied ? "Copiada" : "Copiar senha"}
      </button>
      <p className={darkMuted}>
        Anote ou envie agora: ela não será mostrada de novo. No primeiro login, o jogador terá de criar uma
        senha nova.
      </p>
    </div>
  );
}
