import { useEffect, useRef, useState } from "react";
import { api, BulkAction, CardDetail } from "../api";
import { invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo } from "../lib/undo";
import { CardInfo } from "./CardInfo";
import { DeckSelect } from "./DeckSelect";
import { Close, Maximize, Restore } from "./Icons";
import { FieldValue, NoteFields } from "./NoteFields";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export const FLAG_NAMES = ["No flag", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"];

/** The browser's editor pane. Changes save themselves after a short pause. */
export function CardPanel({
  cardId,
  onChanged,
  onClose,
  maximized = false,
  onToggleMaximize,
}: {
  cardId: number;
  onChanged: (cardId: number, removed?: boolean) => void;
  onClose: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [fields, setFields] = useState<FieldValue[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const pending = useRef<number | null>(null);
  const noteId = useRef<number | null>(null);
  const latest = useRef({ fields, tags, card });
  latest.current = { fields, tags, card };

  const load = (id: number) =>
    api.card(id).then(
      (c) => {
        setCard(c);
        setFields(c.fields.map((f) => ({ name: f.name, value: f.source })));
        setTags(c.tags);
        noteId.current = c.noteId;
        setSave("idle");
      },
      (err) => toast.error(err.message),
    );

  const flush = async () => {
    const { fields: fs, tags: ts, card: c } = latest.current;
    if (!c || noteId.current === null) return;
    setSave("saving");
    try {
      await api.updateNote(noteId.current, { fields: fs.map((f) => f.value), tags: ts });
      setSave("saved");
      onChanged(c.id);
    } catch (err) {
      setSave("error");
      toast.error(`Not saved: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    void load(cardId);
    return () => {
      // Save edits before switching to another card.
      if (pending.current) {
        window.clearTimeout(pending.current);
        pending.current = null;
        void flush();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const schedule = () => {
    setSave("dirty");
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      void flush();
    }, 600);
  };

  const run = async (action: BulkAction, extra: Record<string, unknown> = {}, message?: string) => {
    if (!card) return;
    await api.bulk([card.id], action, extra);
    if (message) doneWithUndo(message);
    invalidate();
    onChanged(card.id, action === "delete");
    if (action !== "delete") void load(card.id);
  };

  if (!card) return <aside className="editor-pane" aria-busy />;
  const suspended = card.queue === -1;
  const saveText = { idle: "", dirty: "Editing…", saving: "Saving…", saved: "Saved", error: "Not saved" }[save];

  return (
    <aside className="editor-pane" aria-label="Edit card">
      <div className="editor-head">
        <div className="meta">
          <span className="badge">{card.notetype.name}</span>
          {card.template !== "Card 1" && card.template !== card.notetype.name && <span>{card.template}</span>}
          <span className={`save-state ${save}`}>{saveText}</span>
        </div>
        <div className="editor-head-actions">
          {onToggleMaximize && (
            <button
              className="icon-btn"
              onClick={onToggleMaximize}
              aria-label={maximized ? "Restore editor" : "Maximise editor"}
              aria-pressed={maximized}
              title={maximized ? "Restore (Esc)" : "Maximise"}
            >
              {maximized ? <Restore /> : <Maximize />}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close editor" title={maximized ? "Close" : "Close (Esc)"}>
            <Close />
          </button>
        </div>
      </div>
      <div className="editor-body">
        <div className="editor-row">
          <label className="field" style={{ flex: 1 }}>
            <span>Deck</span>
            <DeckSelect value={card.deckId} onChange={(id) => void run("move", { deckId: id }, "Card moved.")} />
          </label>
          <label className="field">
            <span>Flag</span>
            <FlagPicker value={card.flag} onChange={(f) => void run("flag", { flag: f })} />
          </label>
        </div>

        <NoteFields
          key={card.noteId}
          idPrefix={`n${card.noteId}`}
          fields={fields}
          onField={(i, v) => {
            setFields((fs) => fs.map((f, j) => (j === i ? { ...f, value: v } : f)));
            schedule();
          }}
          tags={tags}
          onTags={(t) => {
            setTags(t);
            schedule();
          }}
        />

        <section>
          <div className="label" style={{ marginBottom: 6 }}>
            Scheduling
          </div>
          <CardInfo card={card} />
        </section>

        <div className="editor-actions">
          <button className="btn btn-sm" onClick={() => void run(suspended ? "unsuspend" : "suspend", {}, suspended ? "Card unsuspended." : "Card suspended.")}>
            {suspended ? "Unsuspend" : "Suspend"}
          </button>
          <button className="btn btn-sm" onClick={() => void run("setDue", { days: "0" }, "Card due today.")}>
            Make due today
          </button>
          <button className="btn btn-sm" onClick={() => void run("forget", {}, "Card reset to new.")}>
            Reset to new
          </button>
          <button className="btn btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => void run("delete", {}, "Note deleted.")}>
            Delete note
          </button>
        </div>
      </div>
    </aside>
  );
}

export function FlagPicker({ value, onChange }: { value: number; onChange: (f: number) => void }) {
  return (
    <div className="flag-picker" role="radiogroup" aria-label="Flag" style={{ height: 32, alignItems: "center" }}>
      {FLAG_NAMES.map((name, i) => (
        <button
          key={i}
          role="radio"
          aria-checked={value === i}
          className={`flag-dot flag-${i} ${value === i ? "on" : ""}`}
          title={name}
          onClick={() => onChange(value === i ? 0 : i)}
        />
      ))}
    </div>
  );
}
