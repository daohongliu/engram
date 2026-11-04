import { useEffect, useSyncExternalStore } from "react";

/* A forty-line router. Paths look like /browse?q=is:due or /study/123. */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
window.addEventListener("popstate", emit);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  emit();
  if (!opts.replace) window.scrollTo({ top: 0 });
}

export function useLocation() {
  const href = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  return { path: url.pathname, params: url.searchParams };
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) out[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}

/** Intercept clicks on internal <a href="/..."> links. */
export function useLinkInterception() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target || !a.getAttribute("href")?.startsWith("/") || a.hasAttribute("download")) return;
      if (a.getAttribute("href")!.startsWith("/api/")) return;
      e.preventDefault();
      navigate(a.getAttribute("href")!);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
