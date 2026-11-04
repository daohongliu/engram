import { useRef } from "react";
import { MarkdownField, MarkdownFieldHandle } from "../editor/MarkdownField";
import { highestCloze } from "../editor/livePreview";
import { TagInput } from "./TagInput";

export interface FieldValue {
  name: string;
  value: string;
  kind?: "md" | "html";
}

const PLACEHOLDERS: Record<string, string> = {
  Front: "Question. Type $ for maths, or paste an image.",
  Back: "Answer",
  Text: "Text with {{c1::cloze deletions}}. Select text and press ⌘⇧C.",
  "Back Extra": "Extra information shown with the answer",
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
  const editors = useRef<(MarkdownFieldHandle | null)[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef(0);

  return (
    <div className="note-fields">
      {fields.map((f, i) => (
        <div className="note-field" key={`${idPrefix}-${f.name}-${i}`}>
          <div className="note-field-label">
            <span>{f.name}</span>
            <button
              type="button"
              className="field-tool"
              title="Add an image (or paste / drop one into the field)"
              onClick={() => {
                pickFor.current = i;
                picker.current?.click();
              }}
            >
              Add image
            </button>
          </div>
          <MarkdownField
            ref={(h) => {
              editors.current[i] = h;
            }}
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
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) editors.current[pickFor.current]?.insertFiles(files);
          e.target.value = "";
        }}
      />
      <div className="note-field">
        <div className="note-field-label">
          <span>Tags</span>
        </div>
        <TagInput tags={tags} onChange={onTags} />
      </div>
    </div>
  );
}
