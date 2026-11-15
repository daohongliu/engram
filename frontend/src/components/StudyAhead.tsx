import { useEffect, useMemo, useState } from "react";
import { AheadSettings, api } from "../api";
import { closeStudyAhead, useStudyAhead } from "../lib/ahead";
import { plural } from "../lib/format";
import { useLocalStorage } from "../lib/hooks";
import { useKeys } from "../lib/keys";
import { navigate } from "../lib/router";
import { decks as decksStore, flattenDecks, invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { TagInput } from "./TagInput";

const DEFAULTS: AheadSettings = { decks: [], tags: [], tagMode: "any", excludeTags: [], days: 7, newCards: 0, limit: 200 };
const DAY_CHOICES = [1, 3, 7, 14, 30];

/** Mounted once in App; shows the dialog while it is open. */
export function StudyAhead() {
  const open = useStudyAhead();
  return open ? <StudyAheadDialog initialDecks={open.decks} /> : null;
}

/**
 * Study cards before they are due: those due within some days, from every
 * deck or chosen ones, narrowed by tags. The last settings are remembered;
 * opened from a deck or a session, it starts with those decks.
 */
function StudyAheadDialog({ initialDecks }: { initialDecks: number[] | null }) {
  const [saved, save] = useLocalStorage<AheadSettings>("ahead.settings", DEFAULTS);
  const [s, setS] = useState<AheadSettings>(() => ({
    ...DEFAULTS,
    ...saved,
    decks: initialDecks ?? saved.decks ?? [],
  }));
  const set = (patch: Partial<AheadSettings>) => setS((old) => ({ ...old, ...patch }));
  const [chooseDecks, setChooseDecks] = useState(s.decks.length > 0);
  const [count, setCount] = useState<{ reviews: number; new: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const tree = decksStore.use();
  const flat = useMemo(() => (tree ? flattenDecks(tree.decks).filter((d) => !d.filtered) : []), [tree]);
  const settings: AheadSettings = { ...s, decks: chooseDecks ? s.decks : [] };
  const key = JSON.stringify(settings);

  // Count the matching cards as the settings change.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      api.aheadPreview(settings).then(
        (c) => live && setCount(c),
        () => live && setCount(null),
      );
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const start = async () => {
    if (busy || !count?.total) return;
    setBusy(true);
    try {
      const { deckId } = await api.startAhead(settings);
      save(settings);
      invalidate();
      closeStudyAhead();
      navigate(`/study/${deckId}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  useKeys((e) => {
    if (e.key === "Escape") {
      closeStudyAhead();
      return true;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      void start();
      return true;
    }
  });

  const toggleDeck = (id: number) => set({ decks: s.decks.includes(id) ? s.decks.filter((d) => d !== id) : [...s.decks, id] });
  const number = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

  const summary =
    count === null
      ? "Counting…"
      : count.total === 0
        ? "No cards match."
        : [count.reviews && plural(count.reviews, "card") + " due soon", count.new && plural(count.new, "new card")].filter(Boolean).join(" and ");

  return (
    <div className="backdrop" onMouseDown={closeStudyAhead}>
      <div className="panel ahead" role="dialog" aria-label="Study ahead" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Study ahead</h2>
        <p className="muted ahead-intro">
          Review cards before they are due. They count as real reviews, and go back to their decks once answered.
        </p>

        <div className="ahead-row">
          <span className="ahead-label">Due within</span>
          <div className="ahead-days">
            <input
              className="input ahead-number"
              type="number"
              min={0}
              max={365}
              value={s.days}
              onChange={(e) => set({ days: number(e.target.value, 0, 365) })}
              aria-label="Days ahead"
            />
            <span>{s.days === 1 ? "day" : "days"}</span>
            <div className="segmented" role="radiogroup" aria-label="Common choices">
              {DAY_CHOICES.map((d) => (
                <button key={d} role="radio" aria-checked={s.days === d} className={s.days === d ? "on" : ""} onClick={() => set({ days: d })}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ahead-row">
          <span className="ahead-label">From</span>
          <div className="ahead-field">
            <div className="segmented" role="radiogroup" aria-label="Decks">
              <button role="radio" aria-checked={!chooseDecks} className={!chooseDecks ? "on" : ""} onClick={() => setChooseDecks(false)}>
                All decks
              </button>
              <button role="radio" aria-checked={chooseDecks} className={chooseDecks ? "on" : ""} onClick={() => setChooseDecks(true)}>
                Chosen decks{chooseDecks && s.decks.length ? ` (${s.decks.length})` : ""}
              </button>
            </div>
            {chooseDecks && (
              <div className="ahead-decks">
                {flat.map((d) => (
                  <label key={d.id} style={{ paddingLeft: 8 + d.depth * 16 }}>
                    <input type="checkbox" checked={s.decks.includes(d.id)} onChange={() => toggleDeck(d.id)} />
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ahead-row">
          <span className="ahead-label">Tagged</span>
          <div className="ahead-field">
            <TagInput tags={s.tags} onChange={(tags) => set({ tags })} />
            {s.tags.length > 1 && (
              <div className="segmented ahead-mode" role="radiogroup" aria-label="Which tags">
                <button role="radio" aria-checked={s.tagMode === "any"} className={s.tagMode === "any" ? "on" : ""} onClick={() => set({ tagMode: "any" })}>
                  Any of these
                </button>
                <button role="radio" aria-checked={s.tagMode === "all"} className={s.tagMode === "all" ? "on" : ""} onClick={() => set({ tagMode: "all" })}>
                  All of these
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="ahead-row">
          <span className="ahead-label">Not tagged</span>
          <div className="ahead-field">
            <TagInput tags={s.excludeTags} onChange={(excludeTags) => set({ excludeTags })} />
          </div>
        </div>

        <div className="ahead-row">
          <span className="ahead-label">At most</span>
          <div className="ahead-days">
            <input
              className="input ahead-number"
              type="number"
              min={1}
              max={9999}
              value={s.limit}
              onChange={(e) => set({ limit: number(e.target.value, 1, 9999) })}
              aria-label="Most cards"
            />
            <span>cards, plus</span>
            <input
              className="input ahead-number"
              type="number"
              min={0}
              max={9999}
              value={s.newCards}
              onChange={(e) => set({ newCards: number(e.target.value, 0, 9999) })}
              aria-label="New cards"
            />
            <span>new cards</span>
          </div>
        </div>

        <div className="ahead-foot">
          <span className={count?.total === 0 ? "muted" : ""}>{summary}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={closeStudyAhead}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void start()} disabled={!count?.total || busy}>
              Study
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
