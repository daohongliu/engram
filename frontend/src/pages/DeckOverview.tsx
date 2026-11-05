import { useEffect, useState } from "react";
import { api, DeckOptions } from "../api";
import { tip } from "../components/Tooltips";
import { plural } from "../lib/format";
import { isTyping, useKeys } from "../lib/keys";
import { navigate } from "../lib/router";
import { decks as decksStore, flattenDecks, invalidate } from "../lib/store";
import { toast } from "../lib/toast";

/** Like Anki's overview screen: what is waiting, a Study button, and limits. */
export function DeckOverview({ deckId }: { deckId: number }) {
  const data = decksStore.use();
  const deck = flattenDecks(data?.decks ?? []).find((d) => d.id === deckId);
  const [opts, setOpts] = useState<DeckOptions | null>(null);
  const [saved, setSaved] = useState<DeckOptions | null>(null);

  useEffect(() => {
    void decksStore.refresh();
    api.deckOptions(deckId).then(
      (o) => {
        setOpts(o);
        setSaved(o);
      },
      () => {},
    );
  }, [deckId]);

  useKeys((e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    if (e.key === " " || e.key === "Enter" || e.key === "s") {
      navigate(`/study/${deckId}`);
      return true;
    }
  });

  if (data && !deck) {
    return (
      <div className="overview">
        <p className="muted">This deck no longer exists.</p>
        <a href="/">Back to decks</a>
      </div>
    );
  }
  if (!deck) return null;

  const due = deck.new + deck.learn + deck.review;
  const parts = deck.fullName.split("::");
  const dirty = opts && saved && JSON.stringify(opts) !== JSON.stringify(saved);

  const save = async () => {
    if (!opts) return;
    try {
      const o = await api.setDeckOptions(deckId, opts);
      setOpts(o);
      setSaved(o);
      invalidate();
      toast.success("Options saved.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="overview">
      <div className="crumbs">
        <a href="/">Decks</a>
        {parts.slice(0, -1).map((p) => ` › ${p}`)}
      </div>
      <h1>{deck.name}</h1>

      <div className="panel">
        <div className="overview-counts">
          <div>
            <span className="label">New</span>
            <strong className="c-new">{deck.new}</strong>
          </div>
          <div>
            <span className="label">Learning</span>
            <strong className="c-learn">{deck.learn}</strong>
          </div>
          <div>
            <span className="label">To review</span>
            <strong className="c-due">{deck.review}</strong>
          </div>
        </div>
        <div className="overview-actions">
          <span className="muted">{due ? `${plural(deck.total, "card")} in this deck` : "Nothing due right now."}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <a className="btn" href={`/browse?deck=${encodeURIComponent(deck.fullName)}`}>
              Browse
            </a>
            <a className="btn" href={`/add?deck=${deck.id}`}>
              Add
            </a>
            <button className="btn btn-primary" onClick={() => navigate(`/study/${deck.id}`)} disabled={!due} {...tip("", "S or Space")}>
              Study now
            </button>
          </div>
        </div>
      </div>

      {opts && !opts.filtered && (
        <div className="panel overview-options">
          <div className="option-row">
            <div>
              New cards per day
              {opts.sharedWith! > 1 && <small>Shared with {plural(opts.sharedWith! - 1, "other deck")} (preset “{opts.preset}”)</small>}
            </div>
            <input className="input" type="number" min={0} value={opts.newPerDay} onChange={(e) => setOpts({ ...opts, newPerDay: Number(e.target.value) })} />
          </div>
          <div className="option-row">
            <div>Maximum reviews per day</div>
            <input className="input" type="number" min={0} value={opts.reviewsPerDay} onChange={(e) => setOpts({ ...opts, reviewsPerDay: Number(e.target.value) })} />
          </div>
          {opts.fsrs && (
            <div className="option-row">
              <div>
                Desired retention: {Math.round((opts.desiredRetention ?? 0.9) * 100)}%
                <small>Higher means more frequent reviews.</small>
              </div>
              <input
                type="range"
                min={0.75}
                max={0.97}
                step={0.01}
                value={opts.desiredRetention ?? 0.9}
                onChange={(e) => setOpts({ ...opts, desiredRetention: Number(e.target.value) })}
              />
            </div>
          )}
          {dirty && (
            <div className="option-row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setOpts(saved)}>
                Reset
              </button>
              <button className="btn btn-primary" onClick={() => void save()}>
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
