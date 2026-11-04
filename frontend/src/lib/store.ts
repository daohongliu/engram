import { useEffect, useSyncExternalStore } from "react";
import { api, Counts, DeckNode, Notetype, Settings, Tag } from "../api";
import { setPreamble } from "./math";

/**
 * Small shared caches for data that many screens read: the deck tree,
 * search vocabulary, note types and settings. Each can be refreshed after
 * a mutation and every subscriber re-renders.
 */
function resource<T>(load: () => Promise<T>, onLoad?: (v: T) => void) {
  let value: T | null = null;
  let inflight: Promise<T> | null = null;
  const listeners = new Set<() => void>();
  const refresh = () => {
    inflight = load().then((v) => {
      value = v;
      onLoad?.(v);
      inflight = null;
      listeners.forEach((l) => l());
      return v;
    });
    inflight.catch(() => (inflight = null));
    return inflight;
  };
  const use = (): T | null => {
    const v = useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => value,
    );
    useEffect(() => {
      if (value === null && !inflight) void refresh();
    }, []);
    return v;
  };
  return { use, refresh, get: () => value, ensure: () => (value !== null ? Promise.resolve(value) : (inflight ?? refresh())) };
}

export const decks = resource<{ decks: DeckNode[]; totals: Counts }>(api.decks);
export const tags = resource<Tag[]>(api.tags);
export const notetypes = resource<Notetype[]>(api.notetypes);
export const settings = resource<Settings>(api.settings, (s) => setPreamble(s.preamble));

/** Refresh everything that a change to cards or notes could affect. */
export function invalidate() {
  void decks.refresh();
  void tags.refresh();
}

export function flattenDecks(nodes: DeckNode[], depth = 0): (DeckNode & { depth: number })[] {
  return nodes.flatMap((n) => [{ ...n, depth }, ...flattenDecks(n.children, depth + 1)]);
}
