import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(t: Omit<Toast, "id">, ms = 4500) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { ...t, id }];
  emit();
  window.setTimeout(() => dismiss(id), ms);
  return id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  info: (message: string, action?: Toast["action"]) => push({ message, tone: "info", action }, action ? 7000 : 4000),
  success: (message: string, action?: Toast["action"]) =>
    push({ message, tone: "success", action }, action ? 7000 : 4000),
  error: (message: string) => push({ message, tone: "error" }, 7000),
};

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
