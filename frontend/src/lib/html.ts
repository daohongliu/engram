import DOMPurify from "dompurify";
import { typesetElement } from "./math";

/**
 * Turn card HTML (from Anki's template renderer) into safe, typeset DOM.
 * Imported decks can contain arbitrary HTML, so everything goes through
 * DOMPurify first.
 */
export function prepareCardHtml(el: HTMLElement, html: string) {
  el.innerHTML = DOMPurify.sanitize(html, {
    ADD_TAGS: ["audio", "source"],
    ADD_ATTR: ["controls", "preload", "data-ordinal", "data-cloze"],
    FORBID_TAGS: ["style", "form", "input"],
  });
  for (const node of el.querySelectorAll<HTMLElement>("[src]")) {
    const src = node.getAttribute("src") ?? "";
    if (src && !/^(https?:|data:|blob:|\/)/i.test(src)) {
      node.setAttribute("src", `/api/media/${encodeURIComponent(src)}`);
    }
  }
  for (const img of el.querySelectorAll("img")) img.loading = "lazy";
  for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    a.target = "_blank";
    a.rel = "noreferrer";
  }
  typesetElement(el);
}

/** Pull Markdown footnotes out of rendered card HTML, for the margin. */
export function extractFootnotes(el: HTMLElement): { id: string; label: string; html: string }[] {
  const notes: { id: string; label: string; html: string }[] = [];
  for (const section of el.querySelectorAll("section.footnotes")) {
    for (const li of section.querySelectorAll("li.footnote-item")) {
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".footnote-backref").forEach((b) => b.remove());
      notes.push({ id: li.id, label: "", html: clone.innerHTML });
    }
    section.previousElementSibling?.matches("hr.footnotes-sep") && section.previousElementSibling.remove();
    section.remove();
  }
  let n = 0;
  for (const ref of el.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref a")) {
    n += 1;
    const target = ref.getAttribute("href")?.slice(1) ?? "";
    const note = notes.find((x) => x.id === target);
    if (note) note.label = String(n);
    ref.textContent = String(n);
    ref.dataset.note = target;
    ref.removeAttribute("href");
  }
  return notes;
}

/** Plain text of some HTML, for titles and aria labels. */
export function htmlToText(html: string) {
  const div = document.createElement("div");
  div.innerHTML = DOMPurify.sanitize(html);
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}
