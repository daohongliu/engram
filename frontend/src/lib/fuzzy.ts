/** Rank items by how well a needle matches: prefix, then substring, then subsequence. */
export function score(needle: string, hay: string): number {
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (!n) return 1;
  const idx = h.indexOf(n);
  if (idx === 0) return 100 - h.length * 0.01;
  if (idx > 0) return 60 + (/[\s:_\-›]/.test(h[idx - 1]) ? 20 : 0) - idx * 0.1;
  let j = 0;
  for (let i = 0; i < h.length && j < n.length; i++) if (h[i] === n[j]) j++;
  return j === n.length ? 10 - h.length * 0.05 : -1;
}

export function rank<T>(items: T[], needle: string, key: (t: T) => string, limit = 8): T[] {
  return items
    .map((item) => ({ item, s: score(needle, key(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}
