"use client";

import { TOAST_DEFAULT_DURATION_MS, type ToastInput, type ToastItem } from "./types";

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
/** Stable empty snapshot for useSyncExternalStore (SSR / getServerSnapshot). */
export const EMPTY_TOASTS: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener(items);
}

function scheduleDismiss(id: string, durationMs: number) {
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  if (durationMs <= 0) return;
  timers.set(
    id,
    setTimeout(() => {
      dismissToast(id);
    }, durationMs),
  );
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return items;
}

export function pushToast(input: ToastInput): string {
  const id = input.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const durationMs = input.durationMs ?? TOAST_DEFAULT_DURATION_MS[input.tone];
  const existing = items.find((t) => t.id === id);
  if (existing) {
    // Dedupe: refresh timestamp / content, restart timer — do not stack clones.
    items = items.map((t) =>
      t.id === id
        ? {
            ...t,
            tone: input.tone,
            title: input.title,
            description: input.description,
            durationMs,
            createdAt: Date.now(),
          }
        : t,
    );
    scheduleDismiss(id, durationMs);
    emit();
    return id;
  }
  const next: ToastItem = {
    id,
    tone: input.tone,
    title: input.title,
    description: input.description,
    durationMs,
    createdAt: Date.now(),
  };
  items = [...items, next].slice(-5);
  scheduleDismiss(id, durationMs);
  emit();
  return id;
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  const before = items.length;
  items = items.filter((t) => t.id !== id);
  if (items.length !== before) emit();
}

export function clearToasts() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (items.length === 0) return;
  items = [];
  emit();
}
