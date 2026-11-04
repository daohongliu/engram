export function plural(n: number, one: string, many = one + "s") {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function duration(secs: number) {
  if (secs < 60) return secs <= 0 ? "no time" : "under a minute";
  const mins = Math.round(secs / 60);
  if (mins < 60) return plural(mins, "minute");
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : plural(h, "hour");
}

export function ago(unixSecs: number) {
  const diff = Date.now() / 1000 - unixSecs;
  if (diff < 90) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hours ago`;
  const days = Math.round(diff / 86400);
  if (days === 1) return "yesterday";
  if (days < 45) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

export function days(d: number) {
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  if (d < 31) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30.4).toFixed(1).replace(/\.0$/, "")}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, "")}y`;
}


/** Old-style numerals look nicer in prose; tabular ones line up in tables. */
export const fmt = (n: number) => n.toLocaleString();
