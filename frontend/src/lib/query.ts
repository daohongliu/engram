/**
 * Reading Anki search queries back to the user in plain English, and
 * suggesting completions while they type.
 */

export interface Term {
  raw: string;
  start: number;
  end: number;
  negated: boolean;
  kind: "term" | "or" | "and" | "open" | "close";
  phrase: string; // human description, without the negation
}

export const FLAG_NAMES = ["", "red", "orange", "green", "blue", "pink", "turquoise", "purple"];

const IS_PHRASES: Record<string, string> = {
  due: "due today",
  new: "new",
  learn: "being learned",
  review: "in review",
  suspended: "suspended",
  buried: "buried",
  flagged: "flagged",
  hard: "hard (difficulty above 70%)",
  fragile: "slipping (recall odds below 80%)",
  today: "reviewed today",
  fresh: "added today",
  leech: "leeches",
};

const PROP_NAMES: Record<string, string> = {
  ivl: "interval",
  due: "due in",
  reps: "review count",
  lapses: "lapse count",
  ease: "ease",
  d: "difficulty",
  s: "stability",
  r: "recall odds",
  pos: "new-card position",
};

export function tokenize(query: string): { raw: string; start: number; end: number }[] {
  const out: { raw: string; start: number; end: number }[] = [];
  let buf = "";
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === "\\" && i + 1 < query.length) {
      if (!buf) start = i;
      buf += query.slice(i, i + 2);
      i++;
      continue;
    }
    if (ch === '"') {
      if (!buf) start = i;
      inQuote = !inQuote;
      buf += ch;
    } else if (!inQuote && /\s/.test(ch)) {
      if (buf) out.push({ raw: buf, start, end: i });
      buf = "";
    } else if (!inQuote && (ch === "(" || ch === ")") && !buf.endsWith(":")) {
      if (buf) out.push({ raw: buf, start, end: i });
      out.push({ raw: ch, start: i, end: i + 1 });
      buf = "";
    } else {
      if (!buf) start = i;
      buf += ch;
    }
  }
  if (buf) out.push({ raw: buf, start, end: query.length });
  return out;
}

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
const pretty = (s: string) => unquote(s).replace(/\*/g, "…").replace(/::/g, " › ");

export function describeToken(rawToken: string): { negated: boolean; phrase: string } {
  let body = rawToken;
  let negated = false;
  if (body.startsWith("-") && body.length > 1) {
    negated = true;
    body = body.slice(1);
  }
  body = unquote(body);
  const lower = body.toLowerCase();
  if (body.startsWith("#")) return { negated, phrase: `tagged ${pretty(body.slice(1))}` };
  if (body.startsWith("@")) return { negated, phrase: `in a deck like “${pretty(body.slice(1))}”` };
  const colon = body.indexOf(":");
  if (colon > 0) {
    const key = lower.slice(0, colon);
    const value = body.slice(colon + 1);
    const v = unquote(value);
    switch (key) {
      case "deck":
        return { negated, phrase: v === "current" ? "in the current deck" : `in ${pretty(v)}` };
      case "tag":
        return { negated, phrase: v === "none" ? "untagged" : `tagged ${pretty(v)}` };
      case "is":
        return { negated, phrase: IS_PHRASES[v.toLowerCase()] ?? `is ${v}` };
      case "flag": {
        const n = Number(v);
        return { negated, phrase: n === 0 ? "unflagged" : `flagged ${FLAG_NAMES[n] ?? v}` };
      }
      case "added":
        return { negated, phrase: v === "1" ? "added today" : `added in the last ${v} days` };
      case "edited":
        return { negated, phrase: v === "1" ? "edited today" : `edited in the last ${v} days` };
      case "introduced":
        return { negated, phrase: `first seen in the last ${v} days` };
      case "rated": {
        const [days, ease] = v.split(":");
        const how = ease ? ` as ${["", "again", "hard", "good", "easy"][Number(ease)] ?? ease}` : "";
        return { negated, phrase: `answered${how} ${days === "1" ? "today" : `in the last ${days} days`}` };
      }
      case "prop": {
        const m = v.match(/^([a-z]+)(<=|>=|!=|=|<|>)(.+)$/i);
        if (m) {
          const name = PROP_NAMES[m[1].toLowerCase()] ?? m[1];
          const op = { "<=": "≤", ">=": "≥", "!=": "≠", "=": "=", "<": "<", ">": ">" }[m[2]];
          let val = m[3];
          if (["d", "r"].includes(m[1].toLowerCase()) && Number(val) <= 1) val = `${Math.round(Number(val) * 100)}%`;
          else if (["ivl", "due", "s"].includes(m[1].toLowerCase())) val = `${val} days`;
          return { negated, phrase: `with ${name} ${op} ${val}` };
        }
        return { negated, phrase: `with ${v}` };
      }
      case "note":
        return { negated, phrase: `of type ${pretty(v)}` };
      case "card":
        return { negated, phrase: `using template ${pretty(v)}` };
      case "re":
        return { negated, phrase: `matching /${v}/` };
      case "nc":
        return { negated, phrase: `containing “${v}” (ignoring accents)` };
      case "w":
        return { negated, phrase: `containing the word “${v}”` };
      case "dupe":
        return { negated, phrase: "duplicates" };
      case "cid":
      case "nid":
        return { negated, phrase: `with id ${v}` };
      case "preset":
        return { negated, phrase: `using preset ${v}` };
      default:
        return { negated, phrase: `with ${key} matching “${pretty(value)}”` };
    }
  }
  return { negated, phrase: `containing “${pretty(body)}”` };
}

export function parseQuery(query: string): Term[] {
  return tokenize(query).map((t) => {
    const lower = t.raw.toLowerCase();
    if (lower === "or") return { ...t, kind: "or", negated: false, phrase: "or" };
    if (lower === "and") return { ...t, kind: "and", negated: false, phrase: "and" };
    if (t.raw === "(") return { ...t, kind: "open", negated: false, phrase: "(" };
    if (t.raw === ")") return { ...t, kind: "close", negated: false, phrase: ")" };
    const d = describeToken(t.raw);
    return { ...t, kind: "term", ...d };
  });
}

/** Remove one token from a query string (used by the × on a chip). */
export function removeToken(query: string, term: { start: number; end: number }) {
  return (query.slice(0, term.start) + query.slice(term.end)).replace(/\s{2,}/g, " ").trim();
}

/** Add a term if it is missing, remove it if present. */
export function toggleTerm(query: string, term: string) {
  const tokens = tokenize(query);
  const hit = tokens.find((t) => t.raw.toLowerCase() === term.toLowerCase());
  if (hit) return removeToken(query, hit);
  return (query.trim() + " " + term).trim();
}

export function hasTerm(query: string, term: string) {
  return tokenize(query).some((t) => t.raw.toLowerCase() === term.toLowerCase());
}

export function quoteIfNeeded(s: string) {
  return /[\s()]/.test(s) ? `"${s}"` : s;
}

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

export interface Suggestion {
  insert: string;
  label: string;
  hint?: string;
}

export const KEYWORDS: Suggestion[] = [
  { insert: "is:due", label: "is:due", hint: "waiting for you today" },
  { insert: "is:new", label: "is:new", hint: "never studied" },
  { insert: "is:learn", label: "is:learn", hint: "in learning steps" },
  { insert: "is:review", label: "is:review", hint: "graduated cards" },
  { insert: "is:suspended", label: "is:suspended", hint: "set aside" },
  { insert: "is:buried", label: "is:buried", hint: "hidden until tomorrow" },
  { insert: "is:flagged", label: "is:flagged", hint: "any flag" },
  { insert: "is:hard", label: "is:hard", hint: "difficulty > 70%" },
  { insert: "is:fragile", label: "is:fragile", hint: "recall odds < 80%" },
  { insert: "is:today", label: "is:today", hint: "reviewed today" },
  { insert: "is:fresh", label: "is:fresh", hint: "added today" },
  { insert: "is:leech", label: "is:leech", hint: "keeps being forgotten" },
  { insert: "added:7", label: "added:7", hint: "added this week" },
  { insert: "rated:1:1", label: "rated:1:1", hint: "forgotten today" },
  { insert: "prop:ivl>=30", label: "prop:ivl>=30", hint: "interval at least a month" },
  { insert: "prop:due=1", label: "prop:due=1", hint: "due tomorrow" },
  { insert: "flag:1", label: "flag:1", hint: "red flag" },
  { insert: "tag:none", label: "tag:none", hint: "untagged notes" },
  { insert: "deck:", label: "deck:", hint: "exact deck" },
  { insert: "tag:", label: "tag:", hint: "exact tag" },
  { insert: "note:", label: "note:", hint: "note type" },
  { insert: "re:", label: "re:", hint: "regular expression" },
];

function fuzzyScore(needle: string, hay: string): number {
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (!n) return 1;
  const idx = h.indexOf(n);
  if (idx === 0) return 100 - h.length * 0.01;
  if (idx > 0) {
    const boundary = /[\s:_\-›]/.test(h[idx - 1]) ? 20 : 0;
    return 60 + boundary - idx * 0.1;
  }
  // subsequence
  let j = 0;
  let score = 0;
  for (let i = 0; i < h.length && j < n.length; i++) {
    if (h[i] === n[j]) {
      score += 1;
      j++;
    }
  }
  return j === n.length ? 10 + score - h.length * 0.05 : -1;
}

export function rank<T>(items: T[], needle: string, key: (t: T) => string, limit = 8): T[] {
  return items
    .map((item) => ({ item, s: fuzzyScore(needle, key(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.item);
}

export function currentToken(query: string, caret: number) {
  let start = caret;
  let inQuote = false;
  for (let i = 0; i < caret; i++) if (query[i] === '"') inQuote = !inQuote;
  while (start > 0) {
    const ch = query[start - 1];
    if (!inQuote && /[\s()]/.test(ch)) break;
    if (ch === '"' && inQuote) {
      // walk back to the opening quote
      start--;
      while (start > 0 && query[start - 1] !== '"') start--;
      if (start > 0) start--;
      inQuote = false;
      continue;
    }
    start--;
  }
  return { start, end: caret, text: query.slice(start, caret) };
}

export function suggest(
  token: string,
  vocab: { decks: string[]; tags: string[]; notetypes: { name: string }[] } | null,
): Suggestion[] {
  if (!vocab || !token) return [];
  const neg = token.startsWith("-") ? "-" : "";
  const t = neg ? token.slice(1) : token;
  if (t.startsWith("#")) {
    return rank(vocab.tags, t.slice(1), (x) => x).map((tag) => ({
      insert: `${neg}#${quoteIfNeeded(tag)}`,
      label: `#${tag}`,
      hint: "tag",
    }));
  }
  if (t.startsWith("@")) {
    const needle = unquote(t.slice(1).replace(/^"/, ""));
    return rank(vocab.decks, needle, (x) => x).map((deck) => ({
      insert: `${neg}${quoteIfNeeded("deck:" + deck)}`,
      label: deck.replace(/::/g, " › "),
      hint: "deck",
    }));
  }
  const lower = t.toLowerCase();
  const field = (prefix: string, items: string[], hint: string) => {
    const needle = unquote(t.slice(prefix.length).replace(/^"/, ""));
    return rank(items, needle, (x) => x).map((x) => ({
      insert: `${neg}${quoteIfNeeded(prefix + x)}`,
      label: prefix + x,
      hint,
    }));
  };
  if (lower.startsWith("deck:")) return field("deck:", vocab.decks, "deck");
  if (lower.startsWith("tag:")) return field("tag:", vocab.tags, "tag");
  if (lower.startsWith("note:")) return field("note:", vocab.notetypes.map((n) => n.name), "note type");
  if (lower.startsWith("flag:"))
    return FLAG_NAMES.map((name, i) => ({
      insert: `${neg}flag:${i}`,
      label: `flag:${i}`,
      hint: i ? name : "no flag",
    }));
  if (lower.startsWith('"')) return [];
  if (t.length >= 2 || t.endsWith(":")) {
    return KEYWORDS.filter((k) => k.label.startsWith(lower) && k.label !== lower).map((k) => ({
      ...k,
      insert: neg + k.insert,
    }));
  }
  return [];
}
