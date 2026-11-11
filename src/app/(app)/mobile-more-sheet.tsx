"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type RefObject } from "react";
import { LogoutForm } from "@/components/logout-form";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function MobileMoreSheet({
  open,
  onClose,
  showAdmin,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  showAdmin: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = () =>
      panel ? ([...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled"))) : [];

    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    const returnFocusNode = returnFocusRef.current;
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      document.body.style.overflow = previousOverflow;
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      unlock();
      document.removeEventListener("keydown", onKeyDown);
      returnFocusNode?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  const itemClass =
    "flex min-h-12 w-full items-center rounded-xl px-4 text-sm font-medium text-smv-cream transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold";

  return (
    <div className="fixed inset-0 z-30 md:hidden" role="presentation">
      <button
        type="button"
        aria-label="Fechar menu"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] mx-3 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-smv-navy-card shadow-2xl shadow-black/50 ring-1 ring-white/5"
      >
        <div className="border-b border-white/10 px-4 py-3">
          <p id={titleId} className="text-sm font-semibold text-smv-cream">
            Mais
          </p>
        </div>
        <ul className="flex flex-col gap-1 p-2">
          {showAdmin ? (
            <li>
              <Link href="/admin" className={itemClass} onClick={onClose}>
                Admin
              </Link>
            </li>
          ) : null}
          <li>
            <Link href="/account" className={itemClass} onClick={onClose}>
              Conta
            </Link>
          </li>
          <li>
            <LogoutForm
              className="w-full"
              buttonClassName={`${itemClass} text-left text-red-200 hover:bg-red-500/10`}
            >
              Sair
            </LogoutForm>
          </li>
        </ul>
      </div>
    </div>
  );
}
