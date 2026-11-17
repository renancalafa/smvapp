"use client";

import type { ReactNode } from "react";
import { ConfirmProvider, useConfirm, useConfirmSubmit } from "@/components/confirm-dialog";
import { ToastViewport } from "@/components/toast/toast-viewport";
import { useToast } from "@/components/toast/use-toast";

/** Providers de feedback global (toast + confirmação). */
export function AppFeedback({ children }: { children: ReactNode }) {
  return (
    <ConfirmProvider>
      {children}
      <ToastViewport />
    </ConfirmProvider>
  );
}

export { useConfirm, useConfirmSubmit, useToast };
