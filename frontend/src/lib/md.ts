import { findMath } from "../editor/livePreview";
import { escapeHtml, renderTex } from "./math";

/**
 * A tiny inline Markdown renderer for one-line summaries (recent cards,
 * titles). Maths, bold, italics and code; everything else is plain text.
 * Full rendering happens on the server, so this only has to look right.
 */
export function inlineMarkdown(src: string, maxChars = 160): string {
  const firstPara = src.split(/\n\s*\n/)[0].replace(/\n/g, " ");
  const text = firstPara.length > maxChars ? firstPara.slice(0, maxChars) + "…" : firstPara;
  const spans = findMath(text);
  let out = "";
  let last = 0;
  for (const m of spans) {
    out += decorate(text.slice(last, m.from));
    out += renderTex(m.tex, false);
    last = m.to;
  }
  out += decorate(text.slice(last));
  return out;
}

function decorate(s: string) {
  return escapeHtml(s)
    .replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '<span class="cloze-mark">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]");
}
