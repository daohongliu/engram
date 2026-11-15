import { useSyncExternalStore } from "react";

/** Whether the Study ahead dialog is open, and the decks to start it with. */
type State = { decks: number[] | null } | null;

let state: State = null;
const listeners = new Set<() => void>();

/** Open the dialog; `decks` fills in the decks (empty for every deck). */
export function openStudyAhead(decks: number[] | null = null) {
  state = { decks };
  listeners.forEach((l) => l());
}

export function closeStudyAhead() {
  state = null;
  listeners.forEach((l) => l());
}

export function useStudyAhead() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
