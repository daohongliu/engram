import { useSyncExternalStore } from "react";

/**
 * How the field editor shows Markdown and maths:
 * - "split": the editor shows the source as typed, with a rendered preview below it.
 * - "live": formatting and maths render in place, and reappear as source under the cursor.
 */
export type EditorMode = "split" | "live";

const KEY = "editor.mode";
const listeners = new Set<() => void>();

function read(): EditorMode {
  try {
    return localStorage.getItem(KEY) === '"live"' ? "live" : "split";
  } catch {
    return "split";
  }
}

let current = read();

export function setEditorMode(mode: EditorMode) {
  current = mode;
  try {
    localStorage.setItem(KEY, JSON.stringify(mode));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useEditorMode(): EditorMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
