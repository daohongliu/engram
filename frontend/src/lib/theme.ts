import { useSyncExternalStore } from "react";

export type Theme = "auto" | "light" | "dark";
const KEY = "engram.theme";
const OLD_KEY = "better-anki.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme) || (localStorage.getItem(OLD_KEY) as Theme) || "auto";
  } catch {
    return "auto";
  }
}

let current: Theme = read();
apply(current);

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export function cycleTheme() {
  const order: Theme[] = ["auto", "light", "dark"];
  setTheme(order[(order.indexOf(current) + 1) % order.length] ?? "auto");
}

export function useTheme() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
