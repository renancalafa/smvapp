import "server-only";
import type { DispatchEnv } from "./dispatch";

/**
 * TEMPORÁRIO — alvo fixo do smoke de produção (Option B).
 * Remover este ficheiro, a rota `/api/smoke/dispatch` e a secção correspondente
 * em `docs/push-notifications.md` depois do teste.
 */
export const PRODUCTION_SMOKE_TARGET = {
  notificationId: "01a1bca5-1bb0-717c-a4e7-3b9cced7fa52",
  recipientUserId: "01a154a7-dc24-737c-a3e8-564784bcc132",
  username: "calafa",
  expectedSubscriptions: 2,
  cutoffIso: "2026-11-08T19:31:39.568Z",
} as const;

/**
 * UUID dedicado do claim one-shot — NÃO reutilizar o id da Notification.
 * Fica na tabela IdempotentOperation (PK global também usada pelo Modo Pelada);
 * um id separado evita colidir com operationId de comandos de jogo.
 * Apagar esta linha no cleanup.
 */
export const SMOKE_CLAIM_OPERATION_ID = "01a1bca5-5c0f-7111-8111-00000000c1a1";
export const SMOKE_CLAIM_COMMAND = "SMOKE_DISPATCH_ONCE";

export function productionSmokeCutoff(): Date {
  return new Date(PRODUCTION_SMOKE_TARGET.cutoffIso);
}

export function productionSmokeRequest() {
  return {
    notificationId: PRODUCTION_SMOKE_TARGET.notificationId,
    recipientUserId: PRODUCTION_SMOKE_TARGET.recipientUserId,
    expectedSubscriptions: PRODUCTION_SMOKE_TARGET.expectedSubscriptions,
    cutoff: productionSmokeCutoff(),
  };
}

/**
 * Configuração só para a chamada do smoke. Não altera `process.env`.
 * O dispatcher global continua a ler o ambiente real (kill switch ausente = desligado).
 */
export function smokeDispatchEnv(base: DispatchEnv = process.env): DispatchEnv {
  return {
    ...base,
    PUSH_DISPATCH_ENABLED: "true",
    DISPATCH_AFTER: PRODUCTION_SMOKE_TARGET.cutoffIso,
  };
}
