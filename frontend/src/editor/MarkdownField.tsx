import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { api } from "../api";
import { toast } from "../lib/toast";
import { deleteDollarPair, highestCloze, insertCloze, livePreview, wrapWith } from "./livePreview";

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontFamily: "var(--display)", fontSize: "1.45em", fontWeight: "560" },
  { tag: t.heading2, fontFamily: "var(--display)", fontSize: "1.25em", fontWeight: "560" },
  { tag: t.heading3, fontFamily: "var(--display)", fontSize: "1.1em", fontWeight: "600" },
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--ink-3)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.86em", color: "var(--accent-ink)" },
  { tag: t.link, color: "var(--blue)", textDecoration: "underline" },
  { tag: t.url, color: "var(--ink-3)" },
  { tag: t.quote, color: "var(--ink-2)", fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--ink-3)" },
  { tag: t.meta, color: "var(--ink-3)" },
  { tag: t.contentSeparator, color: "var(--ink-3)" },
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

/**
 * A Markdown editor with live preview. Uncontrolled internally (CodeMirror
 * owns the text) but follows `value` when it changes from outside.
 */
export function MarkdownField(props: MarkdownFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const cloze = (same: boolean) => (v: EditorView) => {
      const base = Math.max(latest.current.clozeBase?.() ?? 0, highestCloze(v.state.doc.toString()));
      return insertCloze(v, same ? Math.max(1, base) : base + 1);
    };
    const upload = async (files: File[], v: EditorView, pos: number) => {
      for (const file of files) {
        try {
          const { filename } = await api.uploadMedia(file);
          const isImage = file.type.startsWith("image/");
          const insert = isImage ? `![](${filename})` : `[sound:${filename}]`;
          v.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
          pos += insert.length;
        } catch (err) {
          toast.error(`Could not upload ${file.name}: ${(err as Error).message}`);
        }
      }
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
            void upload(files, v, v.state.selection.main.head);
            return true;
          },
          drop(event, v) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length) return false;
            event.preventDefault();
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.doc.length;
            void upload(files, v, pos);
            return true;
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
}

/** Focus the first editor inside an element. */
export function focusFirstEditor(root: HTMLElement | null) {
  root?.querySelector<HTMLElement>(".cm-content")?.focus();
}
