import katex from "katex";

/**
 * KaTeX rendering with a shared macro table (the user's "preamble") and a
 * small cache, because the same expressions get rendered over and over in
 * lists and in the live-preview editor.
 */

let macros: Record<string, string> = {};
let preambleError: string | null = null;
const cache = new Map<string, string>();
const CACHE_LIMIT = 800;

export function setPreamble(preamble: string): string | null {
  const fresh: Record<string, string> = {};
  preambleError = null;
  const lines = preamble
    .split("\n")
    .map((line) => line.replace(/(^|[^\\])%.*$/, "$1").trim())
    .filter(Boolean);
  // Each line on its own, so one mistake does not lose every macro.
  // Redefining something KaTeX already has (\R, say) is allowed.
  for (const line of lines) {
    const attempt = (src: string) => katex.renderToString(src, { macros: fresh, globalGroup: true, throwOnError: true });
    try {
      attempt(line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/redefine/.test(msg) && line.includes("\\newcommand")) {
        try {
          attempt(line.replace(/\\newcommand/g, "\\renewcommand"));
          continue;
        } catch {
          /* fall through to report */
        }
      }
      preambleError ??= msg.replace(/^KaTeX parse error: /, "");
    }
  }
  macros = fresh;
  cache.clear();
  return preambleError;
}

export function getPreambleError() {
  return preambleError;
}

export function renderTex(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      macros: { ...macros },
      strict: "ignore",
      trust: false,
      output: "html",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/^KaTeX parse error: /, "") : String(err);
    html = `<span class="tex-error" title="${escapeAttr(msg)}">${escapeHtml(tex)}</span>`;
  }
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, html);
  return html;
}

/** Error message for a TeX snippet, or null if it renders cleanly. */
export function texError(tex: string, display: boolean): string | null {
  try {
    katex.renderToString(tex, { displayMode: display, throwOnError: true, macros: { ...macros }, strict: "ignore" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message.replace(/^KaTeX parse error: /, "") : String(err);
  }
}

const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "PRE", "CODE", "NOSCRIPT", "OPTION"]);
const DELIMS: [string, string, boolean][] = [
  ["\\[", "\\]", true],
  ["\\(", "\\)", false],
];

/**
 * Find Anki-style \(...\) and \[...\] maths in an element and typeset it.
 * With `inline`, display maths is set in text style too (for one-line cells).
 */
export function typesetElement(root: HTMLElement, inline = false) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el && el !== root) {
        if (SKIP.has(el.tagName) || el.classList.contains("katex")) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return node.nodeValue && node.nodeValue.includes("\\") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) typesetTextNode(node, inline);
}

function typesetTextNode(node: Text, inline: boolean) {
  const text = node.nodeValue ?? "";
  const frag = document.createDocumentFragment();
  let i = 0;
  let last = 0;
  let changed = false;
  while (i < text.length) {
    let matched = false;
    for (const [open, close, display] of DELIMS) {
      if (text.startsWith(open, i)) {
        const end = text.indexOf(close, i + open.length);
        if (end < 0) continue;
        if (i > last) frag.append(text.slice(last, i));
        const asBlock = display && !inline;
        const span = document.createElement(asBlock ? "div" : "span");
        span.className = asBlock ? "math-block" : "math-inline";
        span.innerHTML = renderTex(text.slice(i + open.length, end), asBlock);
        frag.append(span);
        i = end + close.length;
        last = i;
        matched = changed = true;
        break;
      }
    }
    if (!matched) i++;
  }
  if (!changed) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
