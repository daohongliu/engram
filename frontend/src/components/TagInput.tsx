import { KeyboardEvent, useMemo, useState } from "react";
import { rank } from "../lib/fuzzy";
import { tags as tagsStore } from "../lib/store";

export function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const all = tagsStore.use();
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(0);
  const suggestions = useMemo(
    () => (draft ? rank((all ?? []).map((t) => t.name).filter((t) => !tags.includes(t)), draft, (t) => t, 6) : []),
    [draft, all, tags],
  );

  const commit = (text: string) => {
    const clean = text.trim().replace(/\s+/g, "_").replace(/^#/, "");
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setDraft("");
    setActive(0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || (e.key === " " && draft)) {
      if (!draft && e.key === "Enter") return;
      e.preventDefault();
      commit(suggestions[active] && e.key !== " " && e.key !== "," ? suggestions[active] : draft);
    } else if (e.key === "Tab" && suggestions.length && draft) {
      e.preventDefault();
      commit(suggestions[active]);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    }
  };

  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
          <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <div className="tag-input-box">
        <input
          value={draft}
          placeholder={tags.length ? "" : "Add tags"}
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          onBlur={() => draft && commit(draft)}
          aria-label="Add tag"
        />
        {suggestions.length > 0 && (
          <ul className="popover-list">
            {suggestions.map((s, i) => (
              <li
                key={s}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s);
                }}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
