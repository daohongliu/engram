import { useEffect, useMemo, useRef, useState } from "react";
import { api, CardDetail, RevlogEntry } from "../api";
import { days, plural } from "../lib/format";
import { invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo } from "../lib/undo";
import { FLAG_NAMES } from "../lib/query";
import { DeckSelect } from "./DeckSelect";
import { FieldValue, NoteFields } from "./NoteFields";
import { RoughCircle } from "./Sketch";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * The right-hand panel in the browser: edit the note in place (it saves
 * itself), and read the card's history like a marginal note.
 */
export function CardPanel({
  cardId,
  onChanged,
  onClose,
}: {
  cardId: number;
  onChanged: (cardId: number, structural?: boolean) => void;
  onClose: () => void;
}) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [fields, setFields] = useState<FieldValue[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const loadedFor = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const snapshot = useRef<{ noteId: number; fields: FieldValue[]; tags: string[] } | null>(null);

  const load = (id: number) =>
    api.card(id).then(
      (c) => {
        setCard(c);
        const fs = c.fields.map((f) => ({ name: f.name, value: f.source, kind: f.kind }));
        setFields(fs);
        setTags(c.tags);
        snapshot.current = { noteId: c.noteId, fields: fs, tags: c.tags };
        loadedFor.current = id;
        setSave("idle");
      },
      (err) => toast.error(err.message),
    );

  // Flush unsaved edits when switching cards.
  useEffect(() => {
    void load(cardId);
    return () => {
      if (pending.current) {
        window.clearTimeout(pending.current);
        pending.current = null;
        void flush();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const latest = useRef({ fields, tags, card });
  latest.current = { fields, tags, card };

  const flush = async () => {
    const snap = snapshot.current;
    const { fields: fs, tags: ts, card: c } = latest.current;
    if (!snap || !c) return;
    setSave("saving");
    try {
      await api.updateNote(snap.noteId, { fields: fs.map((f) => f.value), tags: ts });
      snapshot.current = { noteId: snap.noteId, fields: fs, tags: ts };
      setSave("saved");
      onChanged(c.id);
    } catch (err) {
      setSave("error");
      toast.error(`Not saved: ${(err as Error).message}`);
    }
  };

  const schedule = () => {
    setSave("dirty");
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      void flush();
    }, 650);
  };

  const bulk = async (action: Parameters<typeof api.bulk>[1], extra: Record<string, unknown> = {}, message?: string) => {
    if (!card) return;
    await api.bulk([card.id], action, extra);
    if (message) doneWithUndo(message);
    invalidate();
    onChanged(card.id, action === "delete");
    if (action !== "delete") void load(card.id);
  };

  if (!card) return <aside className="card-panel is-loading" aria-busy />;
  const suspended = card.queue === -1;

  return (
    <aside className="card-panel" aria-label="Selected card">
      <header className="panel-head">
        <div>
          <span className="smallcaps">
            {card.notetype.name}
            {card.template !== "Card 1" && ` · ${card.template}`}
          </span>
          <SaveBadge state={save} />
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close panel" title="Close (esc)">
          ×
        </button>
      </header>

      <div className="panel-row">
        <DeckSelect
          value={card.deckId}
          onChange={(id) => void bulk("move", { deckId: id }, "Moved.")}
          className="panel-deck"
        />
        <FlagPicker value={card.flag} onChange={(f) => void bulk("flag", { flag: f })} />
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

      <section className="panel-facts">
        <h3 className="smallcaps">About this card</h3>
        <dl className="facts">
          <Fact k="next" v={suspended ? "suspended" : card.due.label || "—"} />
          {card.stats.interval ? <Fact k="interval" v={days(card.stats.interval)} /> : null}
          <Fact k="reviews" v={String(card.stats.reviews ?? 0)} />
          <Fact k="lapses" v={String(card.stats.lapses ?? 0)} />
          {card.memory && <Fact k="stability" v={days(card.memory.stability)} />}
          {card.memory?.difficulty != null && <Fact k="difficulty" v={`${Math.round(card.memory.difficulty * 100)}%`} />}
          {card.memory?.retrievability != null && <Fact k="recall odds" v={`${Math.round(card.memory.retrievability * 100)}%`} />}
          {card.stats.added && <Fact k="added" v={new Date(Number(card.stats.added) * 1000).toLocaleDateString()} />}
        </dl>
        <History revlog={card.stats.revlog ?? []} />
      </section>

      <footer className="panel-actions">
        <button className="link-button" onClick={() => void bulk(suspended ? "unsuspend" : "suspend", {}, suspended ? "Unsuspended." : "Suspended.")}>
          {suspended ? "Unsuspend" : "Suspend"}
        </button>
        <button className="link-button" onClick={() => void bulk("setDue", { days: "0" }, "Due today.")}>
          Study today
        </button>
        <button className="link-button" onClick={() => void bulk("forget", {}, "Reset to new.")}>
          Forget
        </button>
        <button className="link-button danger" onClick={() => void bulk("delete", {}, "Deleted the note.")}>
          Delete note
        </button>
      </footer>
    </aside>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const text = { idle: "", dirty: "editing…", saving: "saving…", saved: "saved", error: "not saved" }[state];
  return <span className={`save-badge save-${state}`}>{text}</span>;
}

export function FlagPicker({ value, onChange }: { value: number; onChange: (f: number) => void }) {
  return (
    <div className="flag-picker" role="radiogroup" aria-label="Flag">
      {FLAG_NAMES.map((name, i) => (
        <button
          key={i}
          role="radio"
          aria-checked={value === i}
          className={`flag-dot flag-${i} ${value === i ? "on" : ""}`}
          title={i ? `${name} flag` : "no flag"}
          onClick={() => onChange(value === i ? 0 : i)}
        />
      ))}
    </div>
  );
}

const RATING_COLOURS = ["", "var(--again)", "var(--hard)", "var(--good)", "var(--easy)"];
const RATING_NAMES = ["manual", "again", "hard", "good", "easy"];

/** Every review as a dot along a time line, coloured by the answer given. */
function History({ revlog }: { revlog: RevlogEntry[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const entries = revlog
      .filter((r) => r.time)
      .map((r) => ({ ...r, t: Number(r.time) }))
      .sort((a, b) => a.t - b.t);
    if (!entries.length) return [];
    const t0 = entries[0].t;
    const t1 = Math.max(entries[entries.length - 1].t, t0 + 1);
    return entries.map((e) => ({ ...e, x: 10 + ((e.t - t0) / (t1 - t0)) * 260 }));
  }, [revlog]);

  if (!points.length) return <p className="margin-quiet">Never reviewed. A blank page.</p>;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="history">
      <svg viewBox="0 0 280 34" role="img" aria-label={`Review history: ${plural(points.length, "review")}`}>
        <line x1={4} x2={276} y1={17} y2={17} className="chart-axis" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={p.x} cy={17} r={9} fill="transparent" />
            <RoughCircle
              cx={p.x}
              cy={17}
              d={9}
              seed={i + 3}
              color={RATING_COLOURS[p.buttonChosen ?? 0] || "var(--ink-3)"}
              fill={RATING_COLOURS[p.buttonChosen ?? 0] || "var(--ink-3)"}
              options={{ fillStyle: "solid", roughness: 0.5 }}
            />
          </g>
        ))}
      </svg>
      <p className="history-caption">
        {h
          ? `${new Date(h.t * 1000).toLocaleDateString()}: ${RATING_NAMES[h.buttonChosen ?? 0]}${h.interval ? `, next in ${h.interval < 3600 ? `${Math.max(1, Math.round(h.interval / 60))}m` : days(h.interval / 86400)}` : ""}`
          : (
            <>
              {plural(points.length, "review")}:{" "}
              {[1, 2, 3, 4].map((b) => (
                <span key={b} className="history-key" style={{ ["--c" as string]: RATING_COLOURS[b] }}>
                  {RATING_NAMES[b]}
                </span>
              ))}
            </>
          )}
      </p>
    </div>
  );
}
