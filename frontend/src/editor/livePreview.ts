/**
 * Obsidian-style live preview for CodeMirror 6, and a plain source view
 * (`sourceView`) used when the preview sits beside the editor instead.
 *
 * Maths, emphasis, headings, links, images and clozes are
 * shown rendered while the cursor is elsewhere. When the cursor walks into
 * one of them, its source reappears so it can be edited, and for maths a
 * floating preview typesets the expression on every keystroke.
 */

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Range, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, showTooltip, Tooltip, WidgetType } from "@codemirror/view";
import { renderTex, texError } from "../lib/math";

/* ------------------------------------------------------------------ */
/* Finding maths                                                       */
/* ------------------------------------------------------------------ */

export interface MathSpan {
  from: number;
  to: number;
  tex: string;
  display: boolean;
  /** length of the opening and closing delimiters */
  open: number;
  close: number;
}

export function findMath(text: string, skip: [number, number][] = []): MathSpan[] {
  const out: MathSpan[] = [];
  let s = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (s < skip.length && skip[s][1] <= i) s++;
    if (s < skip.length && skip[s][0] <= i) {
      i = skip[s][1];
      continue;
    }
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        const close = next === "(" ? "\\)" : "\\]";
        const end = text.indexOf(close, i + 2);
        if (end >= 0) {
          out.push({ from: i, to: end + 2, tex: text.slice(i + 2, end), display: next === "[", open: 2, close: 2 });
          i = end + 2;
          continue;
        }
      }
      i += 2;
      continue;
    }
    if (ch === "$") {
      if (text[i + 1] === "$") {
        const end = text.indexOf("$$", i + 2);
        if (end >= 0) {
          out.push({ from: i, to: end + 2, tex: text.slice(i + 2, end), display: true, open: 2, close: 2 });
          i = end + 2;
          continue;
        }
        i += 2;
        continue;
      }
      // Inline: no space just inside the dollars, no newline, and the
      // closing dollar is not followed by a digit (so "$5 and $6" is text).
      if (i + 1 < n && !/\s/.test(text[i + 1])) {
        let j = i + 1;
        let found = -1;
        while (j < n && text[j] !== "\n") {
          if (text[j] === "\\") {
            j += 2;
            continue;
          }
          if (text[j] === "$") {
            if (!/\s/.test(text[j - 1]) && !/\d/.test(text[j + 1] ?? "")) found = j;
            break;
          }
          j++;
        }
        if (found > 0) {
          out.push({ from: i, to: found + 1, tex: text.slice(i + 1, found), display: false, open: 1, close: 1 });
          i = found + 1;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.display ? "cm-math cm-math-display" : "cm-math cm-math-inline";
    el.innerHTML = this.tex.trim() ? renderTex(this.tex, this.display) : '<span class="cm-math-empty">∅</span>';
    el.title = "Click to edit";
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
  ) {
    super();
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.className === this.className;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.className;
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

export function mediaUrl(src: string) {
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src;
  let name = src;
  try {
    name = decodeURIComponent(src);
  } catch {
    /* not encoded */
  }
  return `/api/media/${encodeURIComponent(name)}`;
}

/** Split Obsidian-style "caption|300" or "caption|300x200" alt text. */
export function parseImageAlt(alt: string): { caption: string; width: number | null } {
  const m = alt.match(/^(.*?)\|\s*(\d+)(?:\s*x\s*\d+)?\s*$/);
  return m ? { caption: m[1].trim(), width: Number(m[2]) } : { caption: alt, width: null };
}

/**
 * An image shown in place of its Markdown. Dragging the corner handle
 * resizes it and writes the new width back as ![caption|width](file).
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const { caption, width } = parseImageAlt(this.alt);
    const wrap = document.createElement("span");
    wrap.className = "cm-image";
    const img = document.createElement("img");
    img.src = mediaUrl(this.src);
    img.alt = caption;
    img.draggable = false;
    if (width) img.style.width = `${width}px`;
    img.onerror = () => wrap.classList.add("is-missing");
    const handle = document.createElement("span");
    handle.className = "cm-image-handle";
    handle.title = "Drag to resize";
    const label = document.createElement("span");
    label.className = "cm-image-size";
    wrap.append(img, handle, label);

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startW = img.getBoundingClientRect().width;
      const maxW = view.contentDOM.getBoundingClientRect().width - 16;
      wrap.classList.add("is-resizing");
      const move = (e: PointerEvent) => {
        const w = Math.round(Math.max(40, Math.min(maxW, startW + e.clientX - startX)));
        img.style.width = `${w}px`;
        label.textContent = `${w}px`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        wrap.classList.remove("is-resizing");
        const w = Math.round(img.getBoundingClientRect().width);
        const pos = view.posAtDOM(wrap);
        const line = view.state.doc.lineAt(pos);
        // Find this image's Markdown on its line and rewrite the alt text.
        const re = /!\[([^\]]*)\]\(([^)]*)\)/g;
        for (const m of line.text.matchAll(re)) {
          const from = line.from + m.index!;
          const to = from + m[0].length;
          if (pos < from - 1 || pos > to) continue;
          const altFrom = from + 2;
          const altTo = altFrom + m[1].length;
          const next = `${parseImageAlt(m[1]).caption}|${w}`;
          view.dispatch({ changes: { from: altFrom, to: altTo, insert: next } });
          break;
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
    return wrap;
  }
  ignoreEvent(event: Event) {
    return (event.target as HTMLElement | null)?.classList?.contains("cm-image-handle") ?? false;
  }
}

/* ------------------------------------------------------------------ */
/* Focus tracking (we render everything when the editor is not focused) */
/* ------------------------------------------------------------------ */

const setFocus = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocus)) return e.value;
    return value;
  },
});

const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing));

/* ------------------------------------------------------------------ */
/* Building decorations                                                */
/* ------------------------------------------------------------------ */

const hide = Decoration.replace({});
const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

interface Built {
  decorations: DecorationSet;
  math: MathSpan[];
}

function codeRanges(state: EditorState): [number, number][] {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const ranges: [number, number][] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") {
        ranges.push([node.from, node.to]);
        return false;
      }
    },
  });
  return ranges;
}

function build(state: EditorState): Built {
  const focused = state.field(focusField);
  const doc = state.doc;
  const text = doc.toString();
  const ranges = state.selection.ranges;
  const touches = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from);
  const lineTouches = (from: number, to: number) => {
    if (!focused) return false;
    const a = doc.lineAt(from).from;
    const b = doc.lineAt(to).to;
    return ranges.some((r) => r.from <= b && r.to >= a);
  };

  const code = codeRanges(state);
  const math = findMath(text, code);
  const decos: Range<Decoration>[] = []; // marks and line decorations
  const reps: Range<Decoration>[] = []; // replacements (must not overlap)
  const inMath = (from: number, to: number) => math.some((m) => m.from < to && m.to > from);

  // Maths
  for (const m of math) {
    if (touches(m.from, m.to)) {
      decos.push(Decoration.mark({ class: m.display ? "cm-math-src cm-math-src-display" : "cm-math-src" }).range(m.from, m.to));
      decos.push(Decoration.mark({ class: "cm-math-delim" }).range(m.from, m.from + m.open));
      decos.push(Decoration.mark({ class: "cm-math-delim" }).range(m.to - m.close, m.to));
    } else {
      reps.push(Decoration.replace({ widget: new MathWidget(m.tex, m.display) }).range(m.from, m.to));
    }
  }

  // Markdown structure
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      const { name, from, to } = node;
      if (inMath(from, to) && !["Paragraph", "Document", "ListItem", "BulletList", "OrderedList", "Blockquote"].includes(name))
        return false;
      switch (name) {
        case "Emphasis":
        case "StrongEmphasis":
        case "Strikethrough":
        case "InlineCode": {
          if (!touches(from, to)) {
            const cur = node.node.cursor();
            if (cur.firstChild()) {
              do {
                if (/Mark$/.test(cur.name)) reps.push(hide.range(cur.from, cur.to));
              } while (cur.nextSibling());
            }
          }
          return name !== "InlineCode";
        }
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          const level = Number(name.slice(-1));
          decos.push(Decoration.line({ class: `cm-h cm-h${level}` }).range(doc.lineAt(from).from));
          if (!lineTouches(from, to)) {
            const cur = node.node.cursor();
            if (cur.firstChild() && cur.name === "HeaderMark") {
              const end = Math.min(cur.to + 1, to);
              reps.push(hide.range(cur.from, end));
            }
          }
          return true;
        }
        case "ListMark": {
          const parent = node.node.parent?.parent;
          if (parent?.name === "BulletList" && !lineTouches(from, to)) {
            reps.push(Decoration.replace({ widget: new TextWidget("•", "cm-bullet") }).range(from, to));
          }
          return false;
        }
        case "QuoteMark":
          decos.push(Decoration.line({ class: "cm-quote-line" }).range(doc.lineAt(from).from));
          return false;
        case "Image": {
          const src = text.slice(from, to).match(/\]\(<?([^)>\s]+)/)?.[1];
          const alt = text.slice(from, to).match(/^!\[([^\]]*)\]/)?.[1] ?? "";
          if (!src || src.startsWith("uploading:")) return false;
          if (!touches(from, to)) {
            reps.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
          } else {
            // Editing the Markdown: keep the picture in view just after it.
            decos.push(Decoration.mark({ class: "cm-image-src" }).range(from, to));
            decos.push(Decoration.widget({ widget: new ImageWidget(src, alt), side: 1, block: false }).range(to));
          }
          return false;
        }
        case "LinkReference":
          return false;
        case "Link": {
          if (!touches(from, to)) {
            const cur = node.node.cursor();
            if (cur.firstChild()) {
              let afterText = false;
              do {
                if (cur.name === "LinkMark") {
                  if (!afterText) {
                    reps.push(hide.range(cur.from, cur.to));
                    afterText = true;
                  } else {
                    reps.push(hide.range(cur.from, to));
                    break;
                  }
                }
              } while (cur.nextSibling());
            }
            decos.push(Decoration.mark({ class: "cm-link-text" }).range(from, to));
          }
          return false;
        }
      }
      return true;
    },
  });

  // Clozes: {{c1::answer::hint}}
  const inCode = (pos: number) => code.some(([a, b]) => a <= pos && pos < b);
  for (const m of text.matchAll(CLOZE_RE)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (inCode(from)) continue;
    const openLen = 3 + m[1].length + 2; // "{{c" + n + "::"
    const body = m[2];
    const hintAt = findHintSeparator(body);
    const answerEnd = from + openLen + (hintAt >= 0 ? hintAt : body.length);
    const n = Number(m[1]);
    const tone = `cm-cloze-${((n - 1) % 6) + 1}`;
    if (touches(from, to)) {
      decos.push(Decoration.mark({ class: "cm-cloze-syntax" }).range(from, from + openLen));
      decos.push(Decoration.mark({ class: "cm-cloze-syntax" }).range(answerEnd, to));
      if (answerEnd > from + openLen)
        decos.push(Decoration.mark({ class: `cm-cloze ${tone}` }).range(from + openLen, answerEnd));
    } else {
      reps.push(Decoration.replace({ widget: new TextWidget(String(n), `cm-cloze-badge ${tone}`) }).range(from, from + openLen));
      if (answerEnd > from + openLen)
        decos.push(Decoration.mark({ class: `cm-cloze ${tone}` }).range(from + openLen, answerEnd));
      reps.push(
        hintAt >= 0
          ? Decoration.replace({ widget: new TextWidget(body.slice(hintAt + 2), "cm-cloze-hint") }).range(answerEnd, to)
          : hide.range(answerEnd, to),
      );
    }
  }

  return { decorations: Decoration.set([...decos, ...dropOverlaps(reps)], true), math };
}

/** Anki splits answer::hint on the last top-level "::". */
function findHintSeparator(body: string) {
  return body.lastIndexOf("::");
}

/** Replace decorations must not overlap; keep the earliest when two collide. */
function dropOverlaps(reps: Range<Decoration>[]) {
  const sorted = [...reps].sort((a, b) => a.from - b.from || b.to - a.to);
  const keep: Range<Decoration>[] = [];
  let end = -1;
  for (const r of sorted) {
    if (r.from >= end) {
      keep.push(r);
      end = r.to;
    }
  }
  return keep;
}

const livePreviewField = StateField.define<Built>({
  create: (state) => build(state),
  update(value, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setFocus));
    if (tr.docChanged || tr.selection || focusChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return build(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/* ------------------------------------------------------------------ */
/* The floating maths preview                                          */
/* ------------------------------------------------------------------ */

function activeMath(state: EditorState): MathSpan | null {
  if (!state.field(focusField)) return null;
  const head = state.selection.main.head;
  const spans = state.field(livePreviewField).math;
  return spans.find((m) => head >= m.from && head <= m.to) ?? null;
}

function mathTooltipFor(state: EditorState, prev: Tooltip | null): Tooltip | null {
  const span = activeMath(state);
  if (!span || !span.tex.trim()) return null;
  if (prev && prev.pos === span.from) return prev;
  return {
    pos: span.from,
    above: false,
    strictSide: false,
    arrow: false,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-math-preview";
      const body = document.createElement("div");
      body.className = "cm-math-preview-body";
      const status = document.createElement("div");
      status.className = "cm-math-preview-status";
      dom.append(body, status);
      let lastTex = "";
      const render = (state: EditorState) => {
        const s = activeMath(state);
        if (!s) return;
        if (s.tex === lastTex) return;
        lastTex = s.tex;
        const err = texError(s.tex, s.display);
        if (err) {
          dom.classList.add("has-error");
          status.textContent = err;
          // Keep the last good render visible while the expression is
          // half-typed, so the preview does not flicker.
        } else {
          dom.classList.remove("has-error");
          status.textContent = "";
          body.innerHTML = renderTex(s.tex, s.display);
        }
      };
      render(view.state);
      return {
        dom,
        update(update) {
          if (update.docChanged || update.selectionSet) render(update.state);
        },
      };
    },
  };
}

const mathTooltipField = StateField.define<Tooltip | null>({
  create: (state) => mathTooltipFor(state, null),
  update(tip, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setFocus))) return tip;
    return mathTooltipFor(tr.state, tip);
  },
  provide: (f) => showTooltip.from(f),
});

/* ------------------------------------------------------------------ */
/* Typing helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * "$" behaves like a bracket: it pairs, wraps selections and steps over its
 * partner. Typing "$" inside an empty pair "$|$" makes display maths "$$|$$".
 */
const dollarInput = EditorView.inputHandler.of((view, from, to, insert) => {
  if (insert !== "$") return false;
  const { state } = view;
  const sel = state.selection.main;
  if (sel.from !== from || sel.to !== to) return false;
  const before = state.doc.sliceString(from - 1, from);
  const after = state.doc.sliceString(to, to + 1);
  const code = codeRanges(state);
  if (code.some(([a, b]) => a <= from && from < b)) return false;
  if (from !== to) {
    view.dispatch({
      changes: [
        { from, insert: "$" },
        { from: to, insert: "$" },
      ],
      selection: EditorSelection.range(from + 1, to + 1),
    });
    return true;
  }
  if (before === "$" && after === "$") {
    view.dispatch({ changes: { from, insert: "$$" }, selection: { anchor: from + 1 } });
    return true;
  }
  if (after === "$") {
    view.dispatch({ selection: { anchor: from + 1 } });
    return true;
  }
  if (before === "\\" || /\d/.test(after)) return false;
  view.dispatch({ changes: { from, insert: "$$" }, selection: { anchor: from + 1 } });
  return true;
});

export function deleteDollarPair(view: EditorView) {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const d = view.state.doc;
  if (d.sliceString(sel.from - 1, sel.from) === "$" && d.sliceString(sel.from, sel.from + 1) === "$") {
    view.dispatch({ changes: { from: sel.from - 1, to: sel.from + 1 } });
    return true;
  }
  return false;
}

export function wrapWith(view: EditorView, before: string, after = before) {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    if (
      text.startsWith(before) &&
      text.endsWith(after) &&
      text.length >= before.length + after.length
    ) {
      const inner = text.slice(before.length, text.length - after.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    };
  });
  view.dispatch(view.state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

export function highestCloze(text: string) {
  let max = 0;
  for (const m of text.matchAll(/\{\{c(\d+)::/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export function insertCloze(view: EditorView, n: number) {
  return wrapWith(view, `{{c${n}::`, "}}");
}

export const livePreview = [focusField, focusTracker, livePreviewField, mathTooltipField, dollarInput];

/* ------------------------------------------------------------------ */
/* Source mode: everything stays as typed, with a preview beside it    */
/* ------------------------------------------------------------------ */

/** Colour maths and clozes in place, hiding nothing. */
function buildSource(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const code = codeRanges(state);
  const decos: Range<Decoration>[] = [];
  for (const m of findMath(text, code)) {
    decos.push(Decoration.mark({ class: "cm-math-src" }).range(m.from, m.to));
    decos.push(Decoration.mark({ class: "cm-math-delim" }).range(m.from, m.from + m.open));
    decos.push(Decoration.mark({ class: "cm-math-delim" }).range(m.to - m.close, m.to));
  }
  const inCode = (pos: number) => code.some(([a, b]) => a <= pos && pos < b);
  for (const m of text.matchAll(CLOZE_RE)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (inCode(from)) continue;
    const openLen = 3 + m[1].length + 2;
    const hintAt = findHintSeparator(m[2]);
    const answerEnd = from + openLen + (hintAt >= 0 ? hintAt : m[2].length);
    const tone = `cm-cloze-${((Number(m[1]) - 1) % 6) + 1}`;
    decos.push(Decoration.mark({ class: "cm-cloze-syntax" }).range(from, from + openLen));
    decos.push(Decoration.mark({ class: "cm-cloze-syntax" }).range(answerEnd, to));
    if (answerEnd > from + openLen) decos.push(Decoration.mark({ class: `cm-cloze ${tone}` }).range(from + openLen, answerEnd));
  }
  return Decoration.set(decos, true);
}

const sourceField = StateField.define<DecorationSet>({
  create: (state) => buildSource(state),
  update(value, tr) {
    return tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? buildSource(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const sourceView = [sourceField, dollarInput];

/** For tests. */
export function decorationsFor(doc: string, cursor: number | null) {
  let state = EditorState.create({ doc: Text.of(doc.split("\n")), extensions: [livePreview] });
  if (cursor !== null) {
    state = state.update({ effects: setFocus.of(true), selection: { anchor: cursor } }).state;
  }
  return state.field(livePreviewField);
}
