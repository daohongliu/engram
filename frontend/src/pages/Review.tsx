import { useCallback, useEffect, useRef, useState } from "react";
import { api, NextCard, ReviewCard } from "../api";
import { NoteFields } from "../components/NoteFields";
import { Sidenoted } from "../components/Sidenoted";
import { DrawnRule, seedFrom, Teacup } from "../components/Sketch";
import { ago, days, duration, plural } from "../lib/format";
import { isTyping, MOD, useKeys } from "../lib/keys";
import { navigate } from "../lib/router";
import { invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo, onUndo, undoLast } from "../lib/undo";

const RATINGS = [
  { n: 1, label: "Again", tone: "again", note: "no shame, this is how it works" },
  { n: 2, label: "Hard", tone: "hard", note: "got there, eventually" },
  { n: 3, label: "Good", tone: "good", note: "the usual" },
  { n: 4, label: "Easy", tone: "easy", note: "almost insulting" },
];

const FLAG_NAMES = ["", "red", "orange", "green", "blue", "pink", "turquoise", "purple"];

export function Review({ deckId }: { deckId: number }) {
  const [data, setData] = useState<NextCard | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [farewell, setFarewell] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await api.next(deckId);
      setData(next);
      setRevealed(false);
      setLeaving(false);
      shownAt.current = Date.now();
    } catch (err) {
      toast.error((err as Error).message);
      navigate("/");
    }
  }, [deckId]);

  useEffect(() => {
    void load();
    return onUndo(() => void load());
  }, [load]);

  // When only learning cards remain, come back for them when they are due.
  useEffect(() => {
    if (data?.done && data.congrats.learnRemaining && data.congrats.secsUntilNextLearn < 20 * 60) {
      const id = window.setTimeout(() => void load(), (data.congrats.secsUntilNextLearn + 1) * 1000);
      return () => window.clearTimeout(id);
    }
  }, [data, load]);

  const card = data && !data.done ? data.card : null;
  const intervals = data && !data.done ? data.intervals : [];

  const rate = async (rating: number) => {
    if (!card || !revealed || busy.current) return;
    busy.current = true;
    const interval = intervals[rating - 1] ?? "";
    setLeaving(true);
    setFarewell(rating === 1 ? `again in ${interval.replace("<", "")}` : `see you in ${interval}`);
    window.setTimeout(() => setFarewell(null), 1400);
    try {
      await api.answer(deckId, card.id, rating, Date.now() - shownAt.current);
      setSession((s) => s + 1);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
      setLeaving(false);
    } finally {
      busy.current = false;
    }
  };

  const act = async (action: "bury" | "suspend") => {
    if (!card) return;
    await api.bulk([card.id], action);
    doneWithUndo(action === "bury" ? "Buried until tomorrow." : "Suspended. Find it again with is:suspended.");
    void load();
  };

  useKeys((e) => {
    if (editing || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      navigate("/");
      return true;
    }
    if (!card) return;
    if (e.key === " " || e.key === "Enter") {
      if (!revealed) setRevealed(true);
      else void rate(3);
      return true;
    }
    if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      void rate(Number(e.key));
      return true;
    }
    if (e.key === "e") {
      setEditing(true);
      return true;
    }
    if (e.key === "-") {
      void act("bury");
      return true;
    }
    if (e.key === "!") {
      void act("suspend");
      return true;
    }
    if (e.key === "u" || e.key === "z") {
      void undoLast();
      return true;
    }
  });

  if (!data) return <div className="review-loading">Shuffling…</div>;

  return (
    <div className="three-col review-page">
      <aside className="margin margin-left review-left">
        <div className="smallcaps">Studying</div>
        <div className="review-deck">
          {data.deckName.split("::").map((part, i, arr) => (
            <span key={i} className={i === arr.length - 1 ? "current" : ""}>
              {part}
              {i < arr.length - 1 && <span className="crumb-sep"> › </span>}
            </span>
          ))}
        </div>
        <div className="review-counts" aria-label="Remaining">
          <span className={`count-new ${!data.done && data.queue === "new" ? "now" : ""}`} title="new">
            {data.counts.new}
          </span>
          <span className={`count-learn ${!data.done && data.queue === "learn" ? "now" : ""}`} title="learning">
            {data.counts.learn}
          </span>
          <span className={`count-review ${!data.done && data.queue === "review" ? "now" : ""}`} title="due">
            {data.counts.review}
          </span>
        </div>
        {session > 0 && <div className="review-session">{plural(session, "card")} this sitting</div>}
        {card && <CardFacts card={card} revealed={revealed} />}
        {card && (
          <div className="review-keys">
            <div>
              <kbd>space</kbd> {revealed ? "good" : "show answer"}
            </div>
            <div>
              <kbd>e</kbd> edit · <kbd>-</kbd> bury · <kbd>u</kbd> undo
            </div>
            <div>
              <kbd>esc</kbd> leave
            </div>
          </div>
        )}
      </aside>

      <article className="main-col review-main">
        {card ? (
          <>
            <div key={card.id} className={`review-card ${leaving ? "is-leaving" : "is-arriving"}`}>
              <CardFace card={card} revealed={revealed} />
            </div>
            <div className="answer-bar">
              {!revealed ? (
                <button className="show-answer" onClick={() => setRevealed(true)}>
                  Show answer <kbd>space</kbd>
                </button>
              ) : (
                <div className="ratings" role="group" aria-label="How well did you remember?">
                  {RATINGS.map((r) => (
                    <button
                      key={r.n}
                      className={`rating rating-${r.tone}`}
                      data-note={r.note}
                      onClick={() => void rate(r.n)}
                      disabled={leaving}
                    >
                      <span className="rating-label">{r.label}</span>
                      <span className="rating-interval">{intervals[r.n - 1]}</span>
                      <kbd>{r.n}</kbd>
                    </button>
                  ))}
                </div>
              )}
              {farewell && <div className="farewell">{farewell}</div>}
            </div>
          </>
        ) : data.done ? (
          <Finished data={data} deckId={deckId} session={session} />
        ) : null}
      </article>

      {/* The right margin belongs to the card's own footnotes. */}
      <aside className="margin margin-right review-right" />

      {editing && card && (
        <EditDrawer
          noteId={card.noteId}
          onClose={(changed) => {
            setEditing(false);
            if (changed) {
              const wasRevealed = revealed;
              void load().then(() => setRevealed(wasRevealed));
            }
          }}
        />
      )}
    </div>
  );
}

function CardFace({ card, revealed }: { card: ReviewCard; revealed: boolean }) {
  if (!revealed) return <Sidenoted html={card.question} className="card-face" />;
  if (card.answerRepeatsQuestion) {
    return (
      <>
        <Sidenoted html={card.question} className="card-face" />
        <DrawnRule width={600} seed={seedFrom(card.id)} animate className="answer-rule" />
        <div className="answer-reveal">
          <Sidenoted html={card.answer} className="card-face card-answer" />
        </div>
      </>
    );
  }
  return (
    <div className="answer-reveal answer-replace">
      <Sidenoted html={card.answerFull} className="card-face" />
    </div>
  );
}

function CardFacts({ card, revealed }: { card: ReviewCard; revealed: boolean }) {
  const m = card.memory;
  let history: string;
  if (card.isNew) history = "A new card. First impressions matter, but not much: the scheduler will sort it out.";
  else {
    history = `Seen ${plural(card.reps, "time")}`;
    if (card.lapses) history += `, forgotten ${card.lapses === 1 ? "once" : plural(card.lapses, "time")}`;
    if (card.lastReviewed) history += `. Last seen ${ago(card.lastReviewed)}`;
    history += ".";
  }
  return (
    <div className={`card-facts ${revealed ? "is-revealed" : ""}`}>
      <div className="sidenote sidenote-static">
        <span className="smallcaps">{card.notetype}</span>
        {card.template !== "Card 1" && <span className="smallcaps"> · {card.template}</span>}
        <p>{history}</p>
        {revealed && m && (
          <p className="memory-line">
            {m.retrievability !== null && (
              <>
                Odds you would recall it right now: <strong>{Math.round(m.retrievability * 100)}%</strong>.{" "}
              </>
            )}
            The memory is stable for about {days(m.stability)}
            {m.difficulty !== null && (
              <>, and the card rates {m.difficulty > 0.7 ? "hard" : m.difficulty > 0.4 ? "middling" : "easy"} on difficulty</>
            )}
            .
          </p>
        )}
        {m && m.retrievability !== null && revealed && <RecallGauge value={m.retrievability} />}
      </div>
      {card.tags.length > 0 && (
        <div className="card-tags">
          {card.tags.map((t) => (
            <a key={t} className="tag-chip" href={`/browse?q=${encodeURIComponent("#" + t)}`}>
              #{t}
            </a>
          ))}
        </div>
      )}
      {card.flag > 0 && <div className={`flag-note flag-${card.flag}`}>flagged {FLAG_NAMES[card.flag]}</div>}
    </div>
  );
}

function RecallGauge({ value }: { value: number }) {
  return (
    <div className="recall-gauge" title="Estimated probability of recall (FSRS)">
      <div className="recall-gauge-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function Finished({ data, deckId, session }: { data: NextCard & { done: true }; deckId: number; session: number }) {
  const c = data.congrats;
  return (
    <div className="finished">
      <Teacup />
      <h1>That is everything for now.</h1>
      <p className="dek">
        {session
          ? `You went through ${plural(session, "card")} just now${c.studiedToday.cards > session ? `, and ${plural(c.studiedToday.cards, "card")} today in all` : ""}, taking ${duration(c.studiedToday.seconds)}.`
          : "Nothing is due in this deck. The forgetting curve can wait."}
      </p>
      {c.learnRemaining > 0 && c.nextLearnLabel && (
        <p>
          {plural(c.learnRemaining, "learning card")} {c.learnRemaining === 1 ? "comes" : "come"} back in {c.nextLearnLabel}.
          {c.secsUntilNextLearn < 20 * 60 && " Leave this page open and it will notice."}
        </p>
      )}
      {c.haveBuried && <p className="margin-quiet">Some cards are buried until tomorrow.</p>}
      <div className="finished-actions">
        <a className="button button-primary" href="/">
          Back to contents
        </a>
        <a className="button" href={`/write?deck=${deckId}`}>
          Write a card
        </a>
        <a className="button" href={`/browse?q=${encodeURIComponent(`"deck:${data.deckName}"`)}`}>
          Browse this deck
        </a>
      </div>
    </div>
  );
}

function EditDrawer({ noteId, onClose }: { noteId: number; onClose: (changed: boolean) => void }) {
  const [fields, setFields] = useState<{ name: string; value: string; kind: "md" | "html" }[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const original = useRef<string>("");

  useEffect(() => {
    api.note(noteId).then(
      (n) => {
        const fs = n.fields.map((f) => ({ name: f.name, value: f.source, kind: f.kind }));
        setFields(fs);
        setTags(n.tags);
        original.current = JSON.stringify([fs.map((f) => f.value), n.tags]);
      },
      (err) => toast.error(err.message),
    );
  }, [noteId]);

  const save = async () => {
    if (!fields) return;
    const now = JSON.stringify([fields.map((f) => f.value), tags]);
    if (now === original.current) return onClose(false);
    try {
      await api.updateNote(noteId, { fields: fields.map((f) => f.value), tags });
      invalidate();
      toast.success("Saved.");
      onClose(true);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  useKeys((e) => {
    if (e.key === "Escape") {
      void save();
      return true;
    }
  });

  return (
    <div className="drawer-backdrop" onMouseDown={() => void save()}>
      <div className="drawer" role="dialog" aria-label="Edit note" onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>Edit</h2>
          <span className="margin-quiet">
            <kbd>esc</kbd> or <kbd>{MOD} ↵</kbd> saves
          </span>
        </header>
        {fields ? (
          <NoteFields
            fields={fields}
            onField={(i, v) => setFields(fields.map((f, j) => (j === i ? { ...f, value: v } : f)))}
            tags={tags}
            onTags={setTags}
            onSubmit={() => void save()}
            autoFocus
          />
        ) : (
          <p className="margin-quiet">Opening…</p>
        )}
      </div>
    </div>
  );
}
