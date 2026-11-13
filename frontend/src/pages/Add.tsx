import { useEffect, useMemo, useRef, useState } from "react";
import { api, Notetype } from "../api";
import { CardPreview } from "../components/CardPreview";
import { DeckSelect } from "../components/DeckSelect";
import { tip } from "../components/Tooltips";
import { FieldValue, NoteFields } from "../components/NoteFields";
import { focusFirstEditor } from "../editor/MarkdownField";
import { useLocalStorage } from "../lib/hooks";
import { MOD } from "../lib/keys";
import { inlineMarkdown } from "../lib/md";
import { useLocation } from "../lib/router";
import { decks as decksStore, flattenDecks, invalidate, notetypes as notetypesStore } from "../lib/store";
import { toast } from "../lib/toast";
import { undoLast } from "../lib/undo";

const SHORT: Record<string, string> = {
  Basic: "Basic",
  "Basic (and reversed card)": "Basic + reversed",
  Cloze: "Cloze",
};

interface Added {
  noteId: number;
  cardId: number;
  summary: string;
  deck: string;
}

export function Add() {
  const { params } = useLocation();
  const types = notetypesStore.use();
  const deckData = decksStore.use();
  const [lastType, setLastType] = useLocalStorage<number | null>("add.notetype", null);
  const [lastDeck, setLastDeck] = useLocalStorage<number | null>("add.deck", null);
  const deckParam = params.get("deck");
  const [typeId, setTypeId] = useState<number | null>(null);
  const [deckId, setDeckId] = useState<number | null>(deckParam ? Number(deckParam) : lastDeck);
  const [fields, setFields] = useState<FieldValue[]>([]);
  const [tags, setTags] = useLocalStorage<string[]>("add.tags", []);
  const [added, setAdded] = useState<Added[]>([]);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const form = useRef<HTMLDivElement>(null);

  // The latest field values and tags, updated as soon as they change. A
  // submit triggered by a key press reads these, so it never sees a render
  // that is one keystroke behind.
  const fieldsRef = useRef(fields);
  const tagsRef = useRef(tags);
  const busyRef = useRef(false);
  const updateFields = (fn: (old: FieldValue[]) => FieldValue[]) => {
    fieldsRef.current = fn(fieldsRef.current);
    setFields(fieldsRef.current);
  };
  const updateTags = (t: string[]) => {
    tagsRef.current = t;
    setTags(t);
  };

  const notetype: Notetype | undefined = types?.find((t) => t.id === typeId);

  useEffect(() => {
    if (!types?.length || typeId !== null) return;
    setTypeId(types.find((t) => t.id === lastType)?.id ?? types[0].id);
  }, [types, typeId, lastType]);

  useEffect(() => {
    if (deckParam) setDeckId(Number(deckParam));
  }, [deckParam]);

  useEffect(() => {
    if (!deckData) return;
    const flat = flattenDecks(deckData.decks).filter((d) => !d.filtered);
    if (deckId === null || !flat.some((d) => d.id === deckId)) {
      const first = flat.find((d) => d.id !== 1) ?? flat[0];
      if (first) setDeckId(first.id);
    }
  }, [deckData, deckId]);

  useEffect(() => {
    if (!notetype) return;
    updateFields((old) => notetype.fields.map((name, i) => ({ name, value: old.find((f) => f.name === name)?.value ?? old[i]?.value ?? "" })));
  }, [notetype]);

  const deckName = useMemo(() => flattenDecks(deckData?.decks ?? []).find((d) => d.id === deckId)?.fullName ?? "", [deckData, deckId]);

  const submit = async () => {
    const fields = fieldsRef.current;
    const tags = tagsRef.current;
    if (!notetype || deckId === null || busyRef.current) return;
    if (!fields[0]?.value.trim()) {
      toast.error(`${fields[0]?.name ?? "The first field"} is empty.`);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await api.addNote({ notetypeId: notetype.id, deckId, fields: fields.map((f) => f.value), tags });
      setAdded((a) => [{ noteId: r.noteId, cardId: r.cardIds[0], summary: inlineMarkdown(fields[0].value, 90), deck: deckName }, ...a].slice(0, 10));
      toast.success(r.warning ? `Added. Note: ${r.warning}` : `Added to ${deckName.split("::").slice(-1)[0]}.`, {
        label: "Undo",
        run: () => void undoLast(),
      });
      updateFields((fs) => fs.map((f) => ({ ...f, value: "" })));
      setLastType(notetype.id);
      setLastDeck(deckId);
      setRound((n) => n + 1);
      invalidate();
      requestAnimationFrame(() => focusFirstEditor(form.current));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // ⌘/Ctrl+Enter adds the card from anywhere on the page: a field, the tag
  // box, the deck menu, or nowhere in particular. Captured before the
  // editors see it, so it behaves the same everywhere.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.isComposing) return;
      if (document.querySelector(".backdrop")) return; // command menu or a dialog is open
      e.preventDefault();
      e.stopPropagation();
      // A tag still being typed is committed on blur; take it with the card.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".tag-input")) active.blur();
      void submitRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const primary = types?.filter((t) => SHORT[t.name]) ?? [];
  const others = types?.filter((t) => !SHORT[t.name] && t.name !== "Image Occlusion") ?? [];

  return (
    <div className="add-layout">
      <div className="panel add-form" ref={form}>
        <div className="add-form-head">
          <div className="segmented" role="radiogroup" aria-label="Note type">
            {primary.map((t) => (
              <button key={t.id} role="radio" aria-checked={t.id === typeId} className={t.id === typeId ? "on" : ""} onClick={() => setTypeId(t.id)}>
                {SHORT[t.name]}
              </button>
            ))}
          </div>
          {others.length > 0 && (
            <select
              className="select"
              value={others.some((t) => t.id === typeId) ? typeId! : ""}
              onChange={(e) => setTypeId(Number(e.target.value))}
              aria-label="Other note types"
            >
              <option value="" disabled>
                More…
              </option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <label className="field" style={{ marginLeft: "auto" }}>
            <span>Deck</span>
            <DeckSelect value={deckId} onChange={setDeckId} />
          </label>
        </div>
        <div className="add-form-body">
          {notetype && (
            <NoteFields
              key={`${notetype.id}-${round}`}
              idPrefix={`a${round}`}
              fields={fields}
              onField={(i, v) => updateFields((fs) => fs.map((f, j) => (j === i ? { ...f, value: v } : f)))}
              tags={tags}
              onTags={updateTags}
              autoFocus
            />
          )}
        </div>
        <div className="add-form-foot">
          <span className="muted" style={{ fontSize: 12 }}>
            <kbd>{MOD} Enter</kbd> to add
          </span>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy} {...tip("", `${MOD} Enter`)}>
            Add
          </button>
        </div>
      </div>

      <div>
        <div className="panel side-panel">
          <span className="label">Preview</span>
          <CardPreview notetypeId={typeId} fields={fields.map((f) => f.value)} />
        </div>
        {added.length > 0 && (
          <div className="panel side-panel">
            <span className="label">Recently added</span>
            <ul className="recent-list">
              {added.map((a) => (
                <li key={a.noteId}>
                  <a href={`/browse?card=${a.cardId}`} title="Open in Browse" dangerouslySetInnerHTML={{ __html: a.summary }} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
