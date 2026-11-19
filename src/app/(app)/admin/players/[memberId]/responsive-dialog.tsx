"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { darkBtnGhost, darkMuted, darkTitleMd } from "@/lib/ui/dark-surfaces";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Bottom sheet on mobile, centered dialog on desktop — same pattern as /niveis suggest. */
export function ResponsiveDialog({
  open,
  onClose,
  title,
  description,
  triggerRef,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const returnFocusNode = triggerRef.current;

    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (el) => !el.hasAttribute("disabled"),
          )
        : [];

    focusables()[0]?.focus();

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

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocusNode?.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(94dvh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/15 bg-smv-navy shadow-xl shadow-black/50 ring-1 ring-white/10 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className={darkTitleMd}>
              {title}
            </h2>
            {description ? <p className={`mt-1 ${darkMuted}`}>{description}</p> : null}
          </div>
          <button type="button" className={darkBtnGhost} onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-white/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
