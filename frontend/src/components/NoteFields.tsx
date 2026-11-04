import { useRef } from "react";
import { MarkdownField } from "../editor/MarkdownField";
import { highestCloze } from "../editor/livePreview";
import { TagInput } from "./TagInput";

export interface FieldValue {
  name: string;
  value: string;
  kind?: "md" | "html";
}

const PLACEHOLDERS: Record<string, string> = {
  Front: "A question, a prompt, a half-remembered theorem…  ($ starts maths)",
  Back: "The answer. Footnotes[^1] become margin notes.",
  Text: "Write a sentence and wrap the hidden part with ⌘⇧C, like {{c1::this}}.",
  "Back Extra": "Anything to show after the answer.",
};

export function NoteFields({
  fields,
  onField,
  tags,
  onTags,
  onSubmit,
  autoFocus,
  idPrefix = "f",
}: {
  fields: FieldValue[];
  onField: (index: number, value: string) => void;
  tags: string[];
  onTags: (t: string[]) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  idPrefix?: string;
}) {
  const latest = useRef(fields);
  latest.current = fields;
  const clozeBase = () => Math.max(0, ...latest.current.map((f) => highestCloze(f.value)));

  return (
    <div className="note-fields">
      {fields.map((f, i) => (
        <div className="note-field" key={`${idPrefix}-${f.name}-${i}`}>
          <div className="note-field-label">
            <span>{f.name}</span>
            {f.kind === "html" && (
              <span
                className="badge badge-quiet"
                title="This field was written in Anki's HTML editor. It is shown here as Markdown; it is only rewritten if you change it."
              >
                from Anki HTML
              </span>
            )}
          </div>
          <MarkdownField
            value={f.value}
            onChange={(v) => onField(i, v)}
            placeholder={PLACEHOLDERS[f.name] ?? ""}
            autoFocus={autoFocus && i === 0}
            onSubmit={onSubmit}
            clozeBase={clozeBase}
            label={f.name}
          />
        </div>
      ))}
      <div className="note-field">
        <div className="note-field-label">
          <span>Tags</span>
        </div>
        <TagInput tags={tags} onChange={onTags} />
      </div>
    </div>
  );
}
