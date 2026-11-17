"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  darkBtnDanger,
  darkBtnPrimary,
  darkBtnSecondary,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {open && options ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 p-4 sm:items-center"
          role="presentation"
          onClick={() => finish(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smv-confirm-title"
            className="w-full max-w-md rounded-2xl border border-white/15 bg-smv-navy p-4 shadow-xl shadow-black/50 ring-1 ring-white/10"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="smv-confirm-title" className={darkTitleMd}>
              {options.title}
            </h2>
            {options.description ? (
              <p className={`${darkMuted} mt-2`}>{options.description}</p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                className={options.tone === "danger" ? darkBtnDanger : darkBtnPrimary}
                onClick={() => finish(true)}
              >
                {options.confirmLabel ?? "Confirmar"}
              </button>
              <button
                type="button"
                className={darkBtnSecondary}
                onClick={() => finish(false)}
              >
                {options.cancelLabel ?? "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve ser usado dentro de ConfirmProvider.");
  }
  return ctx;
}

/** Helper para onSubmit de forms que antes usavam o diálogo nativo do browser. */
export function useConfirmSubmit() {
  const confirm = useConfirm();
  const bypassRef = useRef(false);
  return useCallback(
    (options: ConfirmOptions) =>
      async (event: { preventDefault: () => void; currentTarget: HTMLFormElement }) => {
        if (bypassRef.current) {
          bypassRef.current = false;
          return;
        }
        event.preventDefault();
        const ok = await confirm(options);
        if (!ok) return;
        bypassRef.current = true;
        event.currentTarget.requestSubmit();
      },
    [confirm],
  );
}
