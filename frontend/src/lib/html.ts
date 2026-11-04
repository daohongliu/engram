import DOMPurify from "dompurify";
import { mediaUrl } from "../editor/livePreview";
import { typesetElement } from "./math";

/**
 * Turn card HTML (from Anki's template renderer) into safe, typeset DOM.
 * Fields may contain raw HTML typed into the editor, so everything goes
 * through DOMPurify first.
 */
export function prepareCardHtml(el: HTMLElement, html: string, inlineMath = false) {
  el.innerHTML = DOMPurify.sanitize(html, {
    ADD_TAGS: ["audio", "source"],
    ADD_ATTR: ["controls", "preload", "data-ordinal", "data-cloze"],
    FORBID_TAGS: ["style", "form", "input"],
  });
  for (const node of el.querySelectorAll<HTMLElement>("[src]")) {
    const src = node.getAttribute("src") ?? "";
    if (src) node.setAttribute("src", mediaUrl(src));
  }
  for (const img of el.querySelectorAll("img")) {
    img.loading = "lazy";
    img.decoding = "async";
    // An image with a chosen width may shrink on a narrow screen, never grow.
    const w = img.getAttribute("width");
    if (w) {
      img.style.width = `${w}px`;
      img.removeAttribute("height");
    }
    img.addEventListener("error", () => img.classList.add("is-missing"), { once: true });
  }
  for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    a.target = "_blank";
    a.rel = "noreferrer";
  }
  typesetElement(el, inlineMath);
}

/** Plain text of some HTML, for titles and aria labels. */
export function htmlToText(html: string) {
  const div = document.createElement("div");
  div.innerHTML = DOMPurify.sanitize(html);
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}
