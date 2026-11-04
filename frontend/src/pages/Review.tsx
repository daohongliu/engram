import { useCallback, useEffect, useRef, useState } from "react";
import { api, CardDetail, NextCard, ReviewCard, UpcomingCard } from "../api";
import { CardHtml } from "../components/CardHtml";
import { CardInfo } from "../components/CardInfo";
import { Close, Edit, Info, More } from "../components/Icons";
import { NoteFields } from "../components/NoteFields";
import { duration, plural } from "../lib/format";
import { isTyping, MOD, useKeys } from "../lib/keys";
import { navigate } from "../lib/router";
import { invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo, onUndo, undoLast } from "../lib/undo";

const RATINGS = [
  { n: 1, label: "Again", tone: "again" },
  { n: 2, label: "Hard", tone: "hard" },
  { n: 3, label: "Good", tone: "good" },
  { n: 4, label: "Easy", tone: "easy" },
];

const FLAGS = ["", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"];

/** Studies one deck with its subdecks, or every deck when deckId is 0. */
export function Review({ deckId }: { deckId: number }) {
  const home = deckId === 0 ? "/" : `/deck/${deckId}`;
  const [data, setData] = useState<NextCard | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [panel, setPanel] = useState<null | "edit" | "info">(null);
  const [menu, setMenu] = useState(false);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);

  const load = useCallback(async (cardId?: number) => {
    try {
      const next = await api.next(deckId, cardId);
      setData(next);
      setRevealed(false);
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

  useEffect(() => {
    if (data?.done && data.congrats.learnRemaining && data.congrats.secsUntilNextLearn < 20 * 60) {
      const id = window.setTimeout(() => void load(), (data.congrats.secsUntilNextLearn + 1) * 1000);
      return () => window.clearTimeout(id);
    }
  }, [data, load]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const card = data && !data.done ? data.card : null;
  const intervals = data && !data.done ? data.intervals : [];
  const queue = data && !data.done ? data.queue : null;

  const rate = async (rating: number) => {
    if (!card || !revealed || busy.current) return;
    busy.current = true;
    try {
      await api.answer(deckId, card.id, rating, Date.now() - shownAt.current);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      busy.current = false;
    }
  };

  const act = async (action: "bury" | "suspend" | "flag" | "delete", flag?: number) => {
    if (!card) return;
    setMenu(false);
    await api.bulk([card.id], action, flag !== undefined ? { flag } : {});
    if (action === "flag") {
      toast.info(flag ? `Flagged ${FLAGS[flag].toLowerCase()}.` : "Flag removed.");
      setData((d) => (d && !d.done ? { ...d, card: { ...d.card, flag: flag ?? 0 } } : d));
      return;
    }
    doneWithUndo({ bury: "Card buried until tomorrow.", suspend: "Card suspended.", delete: "Note deleted." }[action]);
    invalidate();
    void load();
  };

  useKeys((e) => {
    if (panel === "edit" || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (panel) setPanel(null);
      else navigate(home);
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
    const k = e.key.toLowerCase();
    if (k === "e") return setPanel("edit"), true;
    if (k === "i") return setPanel(panel === "info" ? null : "info"), true;
    if (e.key === "-") return void act("bury"), true;
    if (e.key === "!") return void act("suspend"), true;
    if (k === "u") return void undoLast(), true;
  });

  // Jump to a card further down the queue; the one being skipped stays waiting.
  const pick = async (cardId: number) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await load(cardId);
    } finally {
      busy.current = false;
    }
  };

  if (!data) return null;
  const upcoming = data.done ? null : data.upcoming;
  const remaining = data.counts.new + data.counts.learn + data.counts.review;

  return (
    <div className={`review ${upcoming ? "has-up-next" : ""}`}>
      <div className="review-top">
        <a href={home}>← {data.deckName.split("::").join(" › ")}</a>
        {card && card.flag > 0 && (
          <span>
            <span className="cell-flag" style={{ ["--c" as string]: `var(--flag-${card.flag})` }} />
            {FLAGS[card.flag]} flag
          </span>
        )}
      </div>

      {card ? (
        <div className="review-body">
          <div key={card.id} className="card-sheet is-arriving">
            <CardFace card={card} revealed={revealed} />
          </div>
        </div>
      ) : data.done ? (
        <Finished data={data} deckId={deckId} />
      ) : null}

      {card && (
        <div className="review-bar">
          <div className="review-bar-inner">
            <div className="review-bar-left">
              <button className="btn btn-ghost btn-sm" onClick={() => setPanel("edit")} title="Edit (E)">
                <Edit width={14} height={14} /> Edit
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPanel(panel === "info" ? null : "info")} title="Card info (I)">
                <Info width={14} height={14} /> Info
              </button>
            </div>
            <div className="review-center">
              {!revealed ? (
                <button className="btn btn-lg show-answer" onClick={() => setRevealed(true)}>
                  Show answer
                </button>
              ) : (
                <div className="ratings">
                  {RATINGS.map((r) => (
                    <button key={r.n} className={`rating rating-${r.tone}`} onClick={() => void rate(r.n)} title={`${r.label} (${r.n})`}>
                      <span className="rating-interval">{intervals[r.n - 1]}</span>
                      <span className="rating-label">{r.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="review-counts" aria-label="Remaining cards">
                <span className={`c-new ${queue === "new" ? "now" : ""}`} title="New">
                  {data.counts.new}
                </span>
                <span className={`c-learn ${queue === "learn" ? "now" : ""}`} title="Learning">
                  {data.counts.learn}
                </span>
                <span className={`c-due ${queue === "review" ? "now" : ""}`} title="To review">
                  {data.counts.review}
                </span>
              </div>
            </div>
            <div className="review-bar-right">
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(!menu);
                }}
                aria-expanded={menu}
              >
                <More width={14} height={14} /> More
              </button>
              {menu && (
                <div className="menu" style={{ right: 0, bottom: 36 }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => void act("bury")}>Bury card</button>
                  <button onClick={() => void act("suspend")}>Suspend card</button>
                  <hr />
                  {FLAGS.slice(1).map((name, i) => (
                    <button key={name} onClick={() => void act("flag", card.flag === i + 1 ? 0 : i + 1)}>
                      <span className="cell-flag" style={{ ["--c" as string]: `var(--flag-${i + 1})` }} />
                      {card.flag === i + 1 ? `Remove ${name.toLowerCase()} flag` : `${name} flag`}
                    </button>
                  ))}
                  <hr />
                  <button onClick={() => void undoLast()}>Undo</button>
                  <button className="danger" onClick={() => void act("delete")}>
                    Delete note
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {upcoming && <UpNext items={upcoming} more={Math.max(0, remaining - 1 - upcoming.length)} onPick={(id) => void pick(id)} />}

      {panel === "info" && card && <InfoDrawer cardId={card.id} onClose={() => setPanel(null)} />}
      {panel === "edit" && card && (
        <EditDrawer
          noteId={card.noteId}
          onClose={(changed) => {
            setPanel(null);
            if (changed) {
              const was = revealed;
              void load().then(() => setRevealed(was));
            }
          }}
        />
      )}
    </div>
  );
}

const KIND = { new: { label: "New", tone: "c-new" }, learn: { label: "Learning", tone: "c-learn" }, review: { label: "Review", tone: "c-due" } };

function UpNext({ items, more, onPick }: { items: UpcomingCard[]; more: number; onPick: (cardId: number) => void }) {
  return (
    <aside className="up-next" aria-label="Up next">
      <span className="label">Up next</span>
      {items.length ? (
        <ol>
          {items.map((u) => (
            <li key={u.id}>
              <button className="up-next-item" onClick={() => onPick(u.id)} title="Study this card now">
                <span className="up-next-meta">
                  <span className={`up-next-dot ${KIND[u.queue].tone}`} title={KIND[u.queue].label} />
                  <span className="up-next-deck">{u.deck.split("::").join(" › ")}</span>
                </span>
                <CardHtml html={u.question} className="up-next-q" inline />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="up-next-empty">This is the last card for now.</p>
      )}
      {more > 0 && <p className="up-next-empty">and {plural(more, "more card")}</p>}
    </aside>
  );
}

function CardFace({ card, revealed }: { card: ReviewCard; revealed: boolean }) {
  if (!revealed) return <CardHtml html={card.question} />;
  if (card.answerRepeatsQuestion) {
    return (
      <>
        <CardHtml html={card.question} />
        <hr className="card-divider" />
        <div className="card-back">
          <CardHtml html={card.answer} />
        </div>
      </>
    );
  }
  return (
    <div className="card-back">
      <CardHtml html={card.answerFull} />
    </div>
  );
}

function InfoDrawer({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<CardDetail | null>(null);
  useEffect(() => {
    api.card(cardId).then(setDetail, () => {});
  }, [cardId]);
  return (
    <aside className="panel info-drawer" aria-label="Card info">
      <header>
        <h2>Card info</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Close />
        </button>
      </header>
      {detail ? (
        <>
          <p className="muted" style={{ fontSize: 12 }}>
            {detail.notetype.name} · {detail.template} · {detail.deck.split("::").join(" › ")}
          </p>
          <CardInfo card={detail} />
          {detail.tags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 14 }}>
              {detail.tags.map((t) => (
                <a key={t} className="tag-chip" href={`/browse?tag=${encodeURIComponent(t)}`}>
                  {t}
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </aside>
  );
}

function Finished({ data, deckId }: { data: NextCard & { done: true }; deckId: number }) {
  const c = data.congrats;
  return (
    <div className="panel finished">
      <h1>Congratulations</h1>
      <p>{deckId === 0 ? "You have studied everything for now." : "You have finished this deck for now."}</p>
      {c.studiedToday.cards > 0 && (
        <p className="muted">
          Studied {plural(c.studiedToday.cards, "card")} in {duration(c.studiedToday.seconds)} today.
        </p>
      )}
      {c.learnRemaining > 0 && c.nextLearnLabel && (
        <p className="muted">
          {plural(c.learnRemaining, "learning card")} due in {c.nextLearnLabel}.
        </p>
      )}
      {c.haveBuried && <p className="muted">Some cards are buried until tomorrow.</p>}
      <div className="finished-actions">
        <a className="btn" href={deckId === 0 ? "/browse" : `/browse?deck=${encodeURIComponent(data.deckName)}`}>
          Browse
        </a>
        <a className="btn" href={deckId === 0 ? "/add" : `/add?deck=${deckId}`}>
          Add cards
        </a>
        <a className="btn btn-primary" href="/">
          Back to decks
        </a>
      </div>
    </div>
  );
}

function EditDrawer({ noteId, onClose }: { noteId: number; onClose: (changed: boolean) => void }) {
  const [fields, setFields] = useState<{ name: string; value: string }[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const original = useRef("");

  useEffect(() => {
    api.note(noteId).then(
      (n) => {
        const fs = n.fields.map((f) => ({ name: f.name, value: f.source }));
        setFields(fs);
        setTags(n.tags);
        original.current = JSON.stringify([fs.map((f) => f.value), n.tags]);
      },
      (err) => toast.error(err.message),
    );
  }, [noteId]);

  const save = async () => {
    if (!fields) return;
    if (JSON.stringify([fields.map((f) => f.value), tags]) === original.current) return onClose(false);
    try {
      await api.updateNote(noteId, { fields: fields.map((f) => f.value), tags });
      invalidate();
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
    <div className="overlay" style={{ alignItems: "stretch", justifyContent: "flex-end", padding: 0 }} onMouseDown={() => void save()}>
      <div className="panel" style={{ width: "min(560px, 100%)", borderRadius: 0, overflowY: "auto", display: "flex", flexDirection: "column" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <h2>Edit note</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {MOD} Enter to save
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => void save()}>
              Done
            </button>
          </div>
        </div>
        <div className="editor-body">
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
            <p className="muted">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}
