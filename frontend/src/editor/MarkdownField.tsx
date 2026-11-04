import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { api } from "../api";
import { toast } from "../lib/toast";
import { deleteDollarPair, highestCloze, insertCloze, livePreview, wrapWith } from "./livePreview";

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.3em", fontWeight: "600" },
  { tag: t.heading2, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.heading3, fontWeight: "600" },
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-3)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.82em" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--text-3)" },
  { tag: t.quote, color: "var(--text-2)" },
  { tag: t.processingInstruction, color: "var(--text-3)" },
  { tag: t.meta, color: "var(--text-3)" },
  { tag: t.contentSeparator, color: "var(--text-3)" },
]);

export interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  /** Highest cloze number used across the whole note, for ⌘⇧C. */
  clozeBase?: () => number;
  label?: string;
  compact?: boolean;
}

export interface MarkdownFieldHandle {
  /** Upload files and insert them at the cursor (or the end). */
  insertFiles: (files: File[]) => void;
  focus: () => void;
}

let uploadSeq = 0;

/**
 * Upload files and put them into the document. A placeholder goes in
 * straight away and is swapped for the real Markdown when the upload
 * finishes, wherever the placeholder has moved to by then.
 */
async function uploadInto(v: EditorView, files: File[], at: number) {
  let pos = at;
  const jobs = files.map((file) => {
    const id = `uploading:${++uploadSeq}`;
    const before = pos > 0 && !/\s/.test(v.state.doc.sliceString(pos - 1, pos)) ? "\n" : "";
    const placeholder = `${before}![Uploading ${file.name.replace(/[[\]]/g, "")}…](${id})`;
    v.dispatch({ changes: { from: pos, insert: placeholder }, selection: { anchor: pos + placeholder.length } });
    pos += placeholder.length;
    return { file, marker: `](${id})` };
  });
  for (const { file, marker } of jobs) {
    const find = () => {
      const text = v.state.doc.toString();
      const end = text.indexOf(marker);
      if (end < 0) return null;
      const start = text.lastIndexOf("![", end);
      return { from: start, to: end + marker.length };
    };
    try {
      const r = await api.uploadMedia(file);
      const at = find();
      if (!at) continue; // the placeholder was deleted while uploading
      const insert = r.isImage ? `![](${r.filename})` : `[sound:${r.filename}]`;
      v.dispatch({ changes: { from: at.from, to: at.to, insert } });
    } catch (err) {
      const at = find();
      if (at) v.dispatch({ changes: { from: at.from, to: at.to, insert: "" } });
      toast.error(`Could not upload ${file.name}: ${(err as Error).message}`);
    }
  }
}

/**
 * A Markdown editor with live preview. Uncontrolled internally (CodeMirror
 * owns the text) but follows `value` when it changes from outside.
 */
export const MarkdownField = forwardRef<MarkdownFieldHandle, MarkdownFieldProps>(function MarkdownField(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    insertFiles(files) {
      const v = view.current;
      if (!v) return;
      const pos = v.hasFocus ? v.state.selection.main.head : v.state.doc.length;
      void uploadInto(v, files, pos);
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  useEffect(() => {
    const cloze = (same: boolean) => (v: EditorView) => {
      const base = Math.max(latest.current.clozeBase?.() ?? 0, highestCloze(v.state.doc.toString()));
      return insertCloze(v, same ? Math.max(1, base) : base + 1);
    };
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        history(),
        markdown({ base: markdownLanguage }),
        markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "{", "`"] } }),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        closeBrackets(),
        livePreview,
        placeholderExt(props.placeholder ?? ""),
        Prec.high(
          keymap.of([
            { key: "Mod-Enter", run: () => (latest.current.onSubmit?.(), true) },
            { key: "Mod-b", run: (v) => wrapWith(v, "**") },
            { key: "Mod-i", run: (v) => wrapWith(v, "*") },
            { key: "Mod-e", run: (v) => wrapWith(v, "`") },
            { key: "Mod-m", run: (v) => wrapWith(v, "$") },
            { key: "Mod-Shift-m", run: (v) => wrapWith(v, "$$\n", "\n$$") },
            { key: "Mod-Shift-c", run: cloze(false) },
            { key: "Mod-Alt-Shift-c", run: cloze(true) },
            { key: "Backspace", run: deleteDollarPair },
          ]),
        ),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onChange(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste(event, v) {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (!files.length) return false;
            event.preventDefault();
            void uploadInto(v, files, v.state.selection.main.head);
            return true;
          },
          drop(event, v) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length) return false;
            event.preventDefault();
            host.current?.classList.remove("is-drop-target");
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.doc.length;
            void uploadInto(v, files, pos);
            return true;
          },
          dragover(event) {
            if (Array.from(event.dataTransfer?.items ?? []).some((i) => i.kind === "file")) {
              host.current?.classList.add("is-drop-target");
            }
            return false;
          },
          dragleave() {
            host.current?.classList.remove("is-drop-target");
            return false;
          },
        }),
        EditorView.contentAttributes.of({
          "aria-label": props.label ?? "Markdown field",
          spellcheck: "true",
          autocapitalize: "sentences",
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    if (props.autoFocus) requestAnimationFrame(() => v.focus());
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; later prop changes flow through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
    }
  }, [props.value]);

  return <div ref={host} className={`md-field${props.compact ? " md-field-compact" : ""}`} />;
});

/** Focus the first editor inside an element. */
export function focusFirstEditor(root: HTMLElement | null) {
  root?.querySelector<HTMLElement>(".cm-content")?.focus();
}
