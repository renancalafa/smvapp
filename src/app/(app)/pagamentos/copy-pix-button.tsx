"use client";

import { useState } from "react";
import { useToast } from "@/components/toast/use-toast";
import { darkBtnSecondary } from "@/lib/ui/dark-surfaces";

export function CopyPixButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  return (
    <button
      type="button"
      className={darkBtnSecondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          push({
            tone: "success",
            title: "Chave PIX copiada",
            id: "pix-copied",
          });
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
          push({
            tone: "error",
            title: "Não foi possível copiar",
            description: "Copie a chave manualmente.",
            id: "pix-copy-failed",
          });
        }
      }}
    >
      {copied ? "Chave copiada" : "Copiar chave PIX"}
    </button>
  );
}
