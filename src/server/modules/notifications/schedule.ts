import "server-only";
import { after } from "next/server";
import { dispatchPending } from "./dispatch";

/**
 * Agenda trabalho para depois da resposta. Substituível nos testes.
 * Fora de um request Next.js (`after()` lança), não envia — scripts de checagem
 * não disparam push por acidente.
 */
export const pushDispatchRuntime = {
  after(task: () => void | Promise<void>): void {
    try {
      after(task);
    } catch {
      // tsx / scripts / transação de teste: sem store de request.
    }
  },
};

/** Depois do commit. Nunca lança; falha de push fica no log. */
export function schedulePushDispatch(): void {
  pushDispatchRuntime.after(() => {
    void dispatchPending().catch((error) => {
      console.error("dispatchPending", error);
    });
  });
}

/** Agenda o dispatcher só se `work` resolver. Rejeição = transação falhou, não envia. */
export async function commitThenSchedulePush<T>(work: Promise<T>): Promise<T> {
  const result = await work;
  schedulePushDispatch();
  return result;
}
