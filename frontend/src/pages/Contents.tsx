import { useEffect, useRef, useState } from "react";
import { api, DeckNode, DeckOptions } from "../api";
import { Heatmap } from "../components/Charts";
import { Owl, Scribble } from "../components/Sketch";
import { duration, greeting, plural } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { navigate } from "../lib/router";
import { decks as decksStore, invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo, onUndo } from "../lib/undo";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

const MARGIN_TIPS = [
  "Footnotes on a card become margin notes like this one while you study.",
  "In the browser, #tag and @deck are shortcuts for tag: and deck: searches.",
  "Type $ in any field and maths renders as you write, like a good notebook.",
  "⌘K opens the command palette. You can study a deck without touching the mouse.",
  "Paste a screenshot straight into any field, then drag the corner of the picture to resize it.",
  "Ebbinghaus measured his forgetting curve on nonsense syllables. Your cards are, one hopes, more interesting.",
  "The scheduler is FSRS, which models how stable each memory is and when you will probably forget it.",
];

export function Contents() {
  const data = decksStore.use();
  const stats = useAsync(() => api.stats(), []);
  const [newDeck, setNewDeck] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<DeckNode | null>(null);
  const tip = useRef(MARGIN_TIPS[Math.floor(Math.random() * MARGIN_TIPS.length)]).current;

  useEffect(() => {
    void decksStore.refresh();
    return onUndo(() => stats.reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = data?.totals ?? { new: 0, learn: 0, review: 0 };
  const due = totals.new + totals.learn + totals.review;
  const secsPerCard = stats.data?.secsPerCard ?? 10;
  const firstDue = data?.decks.find((d) => d.new + d.learn + d.review > 0);

  const createDeck = async (name: string) => {
    try {
      await api.createDeck(name);
      setNewDeck(null);
      invalidate();
      toast.success(`Made a new deck, “${name}”.`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="three-col contents-page">
      <aside className="margin margin-left">
        <div className="today-box">
          <div className="smallcaps">Today</div>
          <div className="today-number">{due}</div>
          <div className="today-caption">
            {due === 0 ? "nothing waiting" : `cards waiting, about ${duration(due * secsPerCard)}`}
          </div>
          {firstDue && (
            <button className="button button-primary" onClick={() => navigate(`/study/${firstDue.id}`)}>
              Begin with {firstDue.name}
            </button>
          )}
          {stats.data && (
            <dl className="today-facts">
              <div>
                <dt>studied</dt>
                <dd>{plural(stats.data.today.cards, "card")}</dd>
              </div>
              <div>
                <dt>streak</dt>
                <dd title="Consecutive days with at least one review. Rest days are allowed in real life, just not in this number.">
                  {plural(stats.data.streak, "day")}
                </dd>
              </div>
              <div>
                <dt>collection</dt>
                <dd>{plural(stats.data.totalNotes, "note")}</dd>
              </div>
            </dl>
          )}
        </div>
        <div className="margin-actions">
          <button className="link-button" onClick={() => setNewDeck("")}>
            + New deck
          </button>
        </div>
      </aside>

      <article className="main-col">
        <header className="page-header">
          <p className="kicker">{greeting()}.</p>
          <h1>
            Contents
            <Scribble seed={8} width={180} />
          </h1>
          <p className="dek">
            {due === 0
              ? "Everything is up to date. You could write a new card, or simply enjoy not having to."
              : `${capitalise(plural(totals.review, "review"))}, ${plural(totals.learn, "card")} in learning and ${plural(totals.new, "new card")} today.`}
          </p>
        </header>

        <div className="toc-legend" aria-hidden>
          <span className="count-new">new</span>
          <span className="count-learn">learn</span>
          <span className="count-review">due</span>
        </div>
        <ol className="toc">
          {(data?.decks ?? []).map((d, i) => (
            <DeckRow key={d.id} deck={d} number={ROMAN[i] ?? String(i + 1)} depth={0} onOptions={setOptionsFor} />
          ))}
        </ol>
        {newDeck !== null && (
          <form
            className="new-deck-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (newDeck.trim()) void createDeck(newDeck.trim());
            }}
          >
            <input
              autoFocus
              value={newDeck}
              onChange={(e) => setNewDeck(e.target.value)}
              placeholder="Deck name. Use :: for sub-decks, e.g. Maths::Topology"
              onKeyDown={(e) => e.key === "Escape" && setNewDeck(null)}
            />
            <button className="button" type="submit">
              Create
            </button>
          </form>
        )}

        {stats.data && (
          <figure className="figure">
            <Heatmap calendar={stats.data.calendar} />
            <figcaption>
              <strong>Fig. 1.</strong> A year of reviews, one square per day. Hatching gets denser as the day gets busier.
            </figcaption>
          </figure>
        )}
      </article>

      <aside className="margin margin-right">
        <div className="sidenote">
          <span className="sidenote-mark">†</span> {tip}
        </div>
        <div className="margin-owl" title="Hoo.">
          <Owl />
        </div>
      </aside>

      {optionsFor && <DeckOptionsDialog deck={optionsFor} onClose={() => setOptionsFor(null)} />}
    </div>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function DeckRow({
  deck,
  number,
  depth,
  onOptions,
}: {
  deck: DeckNode;
  number: string;
  depth: number;
  onOptions: (d: DeckNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0 || !deck.collapsed);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const due = deck.new + deck.learn + deck.review;
  const hasKids = deck.children.length > 0;

  const rename = async (name: string) => {
    setRenaming(false);
    if (!name || name === deck.fullName) return;
    try {
      await api.renameDeck(deck.id, name);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    setMenu(false);
    const r = await api.deleteDeck(deck.id);
    invalidate();
    doneWithUndo(`Deleted “${deck.name}” and ${plural(r.removedCards, "card")}.`);
  };

  return (
    <li className={`toc-item depth-${depth} ${due ? "" : "is-quiet"}`}>
      <div className="toc-row">
        <span className="toc-number">{number}</span>
        {hasKids ? (
          <button className={`toc-toggle ${open ? "open" : ""}`} onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
            ›
          </button>
        ) : (
          <span className="toc-toggle-spacer" />
        )}
        {renaming ? (
          <input
            className="toc-rename"
            autoFocus
            defaultValue={deck.fullName}
            onBlur={(e) => void rename(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename((e.target as HTMLInputElement).value.trim());
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <a className="toc-title" href={`/study/${deck.id}`} title={due ? `Study ${deck.name}` : `${deck.name}: nothing due`}>
            {deck.name}
          </a>
        )}
        <span className="toc-leader" aria-hidden />
        <span className="toc-counts">
          <span className={`count-new ${deck.new ? "" : "zero"}`} title="new">{deck.new}</span>
          <span className={`count-learn ${deck.learn ? "" : "zero"}`} title="learning">{deck.learn}</span>
          <span className={`count-review ${deck.review ? "" : "zero"}`} title="due">{deck.review}</span>
        </span>
        <span className="toc-actions">
          <a href={`/browse?q=${encodeURIComponent(`"deck:${deck.fullName}"`)}`} title="Browse this deck">browse</a>
          <a href={`/write?deck=${deck.id}`} title="Write a card here">write</a>
          <button onClick={() => setMenu(!menu)} aria-label="More" aria-expanded={menu}>
            ⋯
          </button>
          {menu && (
            <span className="toc-menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => (setMenu(false), onOptions(deck))}>Daily limits…</button>
              <button onClick={() => (setMenu(false), setRenaming(true))}>Rename</button>
              <button className="danger" onClick={() => void remove()}>
                Delete deck
              </button>
            </span>
          )}
        </span>
      </div>
      {hasKids && open && (
        <ol className="toc-children">
          {deck.children.map((c, i) => (
            <DeckRow key={c.id} deck={c} number={`${depth === 0 ? romanToInt(number) : number}.${i + 1}`} depth={depth + 1} onOptions={onOptions} />
          ))}
        </ol>
      )}
    </li>
  );
}

function romanToInt(r: string) {
  return ROMAN.indexOf(r) + 1;
}

function DeckOptionsDialog({ deck, onClose }: { deck: DeckNode; onClose: () => void }) {
  const [opts, setOpts] = useState<DeckOptions | null>(null);
  useEffect(() => {
    api.deckOptions(deck.id).then(setOpts, (e) => toast.error(e.message));
  }, [deck.id]);

  const save = async () => {
    if (!opts) return;
    try {
      await api.setDeckOptions(deck.id, opts);
      invalidate();
      toast.success("Limits saved.");
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const retention = opts?.desiredRetention ?? 0.9;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={`Options for ${deck.name}`} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{deck.name}</h2>
        {!opts ? (
          <p className="margin-quiet">Reading…</p>
        ) : opts.filtered ? (
          <p>This is a filtered deck; its cards keep the limits of their home decks.</p>
        ) : (
          <>
            {opts.sharedWith! > 1 && (
              <p className="dialog-note">
                These settings live in the preset “{opts.preset}”, which {opts.sharedWith! - 1} other{" "}
                {opts.sharedWith! - 1 === 1 ? "deck shares" : "decks share"}.
              </p>
            )}
            <label className="field-row">
              <span>New cards a day</span>
              <input type="number" min={0} value={opts.newPerDay} onChange={(e) => setOpts({ ...opts, newPerDay: Number(e.target.value) })} />
            </label>
            <label className="field-row">
              <span>Reviews a day, at most</span>
              <input type="number" min={0} value={opts.reviewsPerDay} onChange={(e) => setOpts({ ...opts, reviewsPerDay: Number(e.target.value) })} />
            </label>
            {opts.fsrs && (
              <label className="field-row field-row-wide">
                <span>
                  How much do you want to remember? <strong>{Math.round(retention * 100)}%</strong>
                </span>
                <input
                  type="range"
                  min={0.75}
                  max={0.97}
                  step={0.01}
                  value={retention}
                  onChange={(e) => setOpts({ ...opts, desiredRetention: Number(e.target.value) })}
                />
                <small>
                  {retention >= 0.93
                    ? "Ambitious. You will see cards much more often for each extra percent."
                    : retention <= 0.82
                      ? "Relaxed. Fewer reviews, and you will forget a little more."
                      : "A sensible middle. FSRS schedules each card so you would recall it about this often."}
                </small>
              </label>
            )}
            <div className="dialog-actions">
              <button className="button" onClick={onClose}>
                Cancel
              </button>
              <button className="button button-primary" onClick={() => void save()}>
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
