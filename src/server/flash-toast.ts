import "server-only";
import { cookies } from "next/headers";
import {
  PAYMENT_RESTRICTED_FLASH,
  SMV_FLASH_COOKIE,
  type FlashToastPayload,
} from "@/components/toast/types";

/** Flash cookie legível no cliente após redirect (sem detalhes financeiros). */
export async function setFlashToast(payload: FlashToastPayload): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: SMV_FLASH_COOKIE,
    value: encodeURIComponent(JSON.stringify(payload)),
    path: "/",
    maxAge: 120,
    sameSite: "lax",
    httpOnly: false,
  });
}

export async function setPaymentRestrictedFlash(): Promise<void> {
  await setFlashToast(PAYMENT_RESTRICTED_FLASH);
}
