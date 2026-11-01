"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { getViewer } from "@/server/auth/dal";
import {
  handleSendTestPush,
  handleSubscribePush,
  handleUnsubscribePush,
  type PushActionResult,
} from "./handlers";

// Chamadas pelo cliente fora de <form>: sessão inválida volta como erro, sem redirect.

/** `replacesEndpoint`: inscrição anterior deste aparelho, criada com uma chave VAPID antiga. */
export async function subscribePushAction(
  subscription: unknown,
  replacesEndpoint: unknown = null,
): Promise<PushActionResult> {
  const viewer = await getViewer();
  const userAgent = (await headers()).get("user-agent");
  const result = await handleSubscribePush(viewer, subscription, userAgent, replacesEndpoint);
  if (result.status === "done") refresh();
  return result;
}

export async function unsubscribePushAction(endpoint: unknown): Promise<PushActionResult> {
  const result = await handleUnsubscribePush(await getViewer(), endpoint);
  if (result.status === "done") refresh();
  return result;
}

export async function sendTestPushAction(endpoint: unknown): Promise<PushActionResult> {
  const result = await handleSendTestPush(await getViewer(), endpoint);
  refresh();
  return result;
}
