import { markdownLanguage } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import { findMath } from "../editor/livePreview";
import { escapeHtml } from "./math";

/**
 * Render a field's Markdown to HTML for the editor's side preview, without
 * a round trip to the server. It mirrors the server's renderer in
 * backend/engram/fields.py: CommonMark with tables, strikethrough, line
 * breaks, raw HTML, Anki-style maths and ![caption|300](file) image sizes.
 * Cloze deletions are shown highlighted, as in the Notes view of Browse.
 *
 * Maths comes out as \(...\) and \[...\], which CardHtml then typesets.
 */

const md = new MarkdownIt("commonmark", { html: true, breaks: true, typographer: false });
md.enable(["table", "strikethrough"]);

const SIZE_RE = /^(.*?)\|\s*(\d+)(?:\s*x\s*(\d+))?\s*$/;

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  let alt = self.renderInlineAsText(token.children ?? [], options, env);
  const attrs = [`src="${escapeAttr(token.attrGet("src") ?? "")}"`];
  const size = alt.match(SIZE_RE);
  if (size) {
    alt = size[1].trim();
    attrs.push(`width="${size[2]}"`);
    if (size[3]) attrs.push(`height="${size[3]}"`);
  }
  attrs.push(`alt="${escapeAttr(alt)}"`);
  const title = token.attrGet("title");
  if (title) attrs.push(`title="${escapeAttr(title)}"`);
  return `<img ${attrs.join(" ")}>`;
};

const CLOZE_RE = /\{\{c\d+::([\s\S]*?)(?:::[^}]*?)?\}\}/g;
// Private-use characters stand in for maths while Markdown runs, so that
// Markdown never sees (or mangles) the TeX inside.
const HOLD_RE = /(\d+)/g;

function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  markdownLanguage.parser.parse(text).iterate({
    enter(node) {
      if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") {
        ranges.push([node.from, node.to]);
        return false;
      }
    },
  });
  return ranges;
}

export function renderFieldPreview(source: string): string {
  if (!source.trim()) return "";
  const spans = findMath(source, codeRanges(source));
  let held = "";
  let last = 0;
  spans.forEach((m, i) => {
    held += source.slice(last, m.from) + `${i}`;
    last = m.to;
  });
  held += source.slice(last);

  let html = md.render(held).trim();
  if (html.startsWith("<p>") && html.endsWith("</p>") && html.indexOf("<p>", 1) < 0) html = html.slice(3, -4);
  html = html.replace(CLOZE_RE, '<span class="cloze">$1</span>');
  return html.replace(HOLD_RE, (_, i: string) => {
    const m = spans[Number(i)];
    // Inside maths a deletion is shown as its answer, as on the back of a card.
    const tex = escapeHtml(m.tex.replace(CLOZE_RE, "$1"));
    return m.display ? `\\[${tex.replace(/^\n+|\n+$/g, "")}\\]` : `\\(${tex}\\)`;
  });
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
