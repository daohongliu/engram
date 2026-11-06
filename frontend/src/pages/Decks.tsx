import { useEffect, useState } from "react";
import { api, DeckNode } from "../api";
import { Chevron, More, Plus } from "../components/Icons";
import { duration, plural } from "../lib/format";
import { useAsync, useLocalStorage } from "../lib/hooks";
import { navigate } from "../lib/router";
import { decks as decksStore, invalidate } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo, onUndo } from "../lib/undo";

export function Decks() {
  const data = decksStore.use();
  const stats = useAsync(() => api.stats(), []);
  const [creating, setCreating] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useLocalStorage<number[]>("decks.collapsed", []);
  // Decks ticked for studying together; remembered, since it is often the same set.
  const [picked, setPicked] = useLocalStorage<number[]>("decks.picked", []);

  useEffect(() => {
    void decksStore.refresh();
    return onUndo(() => stats.reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (name: string) => {
    try {
      await api.createDeck(name);
      setCreating(null);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggle = (id: number) => setCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  const rows: { deck: DeckNode; depth: number }[] = [];
  const walk = (nodes: DeckNode[], depth: number) => {
    for (const d of nodes) {
      rows.push({ deck: d, depth });
      if (d.children.length && !collapsed.includes(d.id)) walk(d.children, depth + 1);
    }
  };
  walk(data?.decks ?? [], 0);

  const totals = data?.totals;
  const due = totals ? totals.new + totals.learn + totals.review : 0;

  // Every deck with its parents, to tell when a ticked parent covers a deck.
  const byId = new Map<number, { deck: DeckNode; parents: number[] }>();
  const index = (nodes: DeckNode[], parents: number[]) => {
    for (const d of nodes) {
      byId.set(d.id, { deck: d, parents });
      index(d.children, [...parents, d.id]);
    }
  };
  index(data?.decks ?? [], []);
  const chosen = picked.filter((id) => byId.has(id) && !byId.get(id)!.parents.some((p) => picked.includes(p)));
  const coveredBy = (id: number) => byId.get(id)?.parents.some((p) => chosen.includes(p)) ?? false;
  const chosenDue = chosen.reduce((n, id) => {
    const d = byId.get(id)!.deck;
    return n + d.new + d.learn + d.review;
  }, 0);
  const pick = (id: number) => {
    if (chosen.includes(id)) setPicked(chosen.filter((x) => x !== id));
    // Ticking a deck takes in its subdecks, so they need no ticks of their own.
    else setPicked([...chosen.filter((x) => !byId.get(x)?.parents.includes(id)), id]);
  };

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Decks</h1>
          {stats.data && (
            <p>
              {stats.data.today.cards
                ? `Studied ${plural(stats.data.today.cards, "card")} in ${duration(stats.data.today.seconds)} today.`
                : "No cards studied yet today."}
              {due > 0 && ` ${plural(due, "card")} waiting, about ${duration(due * stats.data.secsPerCard)}.`}
            </p>
          )}
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setCreating("")}>
            <Plus /> Create deck
          </button>
          {chosen.length > 0 ? (
            <>
              <button className="btn btn-ghost" onClick={() => setPicked([])}>
                Clear
              </button>
              <button className="btn btn-primary" onClick={() => navigate(`/study/${chosen.join(",")}`)} disabled={!chosenDue}>
                {chosen.length === 1 ? "Study 1 deck" : `Study ${chosen.length} decks`}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate("/study/all")} disabled={!due} title="Study cards from every deck">
              Study all
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        {data && rows.length === 0 ? (
          <div className="empty-state">
            <h2>No decks yet</h2>
            <p>Create a deck, then add cards to it.</p>
          </div>
        ) : (
          <table className={`deck-table ${chosen.length ? "is-picking" : ""}`}>
            <thead>
              <tr>
                <th className="col-pick" />
                <th>Deck</th>
                <th className="col-count">New</th>
                <th className="col-count">Learn</th>
                <th className="col-count">Due</th>
                <th className="col-menu" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ deck, depth }) => (
                <DeckRow
                  key={deck.id}
                  deck={deck}
                  depth={depth}
                  open={!collapsed.includes(deck.id)}
                  onToggle={() => toggle(deck.id)}
                  picked={chosen.includes(deck.id)}
                  covered={coveredBy(deck.id)}
                  onPick={() => pick(deck.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating !== null && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (creating.trim()) void create(creating.trim());
          }}
        >
          <input
            className="input"
            autoFocus
            value={creating}
            onChange={(e) => setCreating(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setCreating(null)}
            placeholder="Deck name (use :: for subdecks, e.g. Maths::Topology)"
          />
          <button className="btn btn-primary" type="submit">
            Create
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setCreating(null)}>
            Cancel
          </button>
        </form>
      )}

      {stats.data && (
        <div className="panel today-strip">
          <div>
            <span className="label">Today</span>
            <strong>{stats.data.today.cards}</strong>
          </div>
          <div>
            <span className="label">Streak</span>
            <strong>{plural(stats.data.streak, "day")}</strong>
          </div>
          <div>
            <span className="label">Retention (30d)</span>
            <strong>{stats.data.retention === null ? "—" : `${Math.round(stats.data.retention * 100)}%`}</strong>
          </div>
          <div>
            <span className="label">Notes</span>
            <strong>{stats.data.totalNotes.toLocaleString()}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function DeckRow({
  deck,
  depth,
  open,
  onToggle,
  picked,
  covered,
  onPick,
}: {
  deck: DeckNode;
  depth: number;
  open: boolean;
  onToggle: () => void;
  picked: boolean;
  covered: boolean;
  onPick: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

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
    const r = await api.deleteDeck(deck.id);
    invalidate();
    doneWithUndo(`Deleted “${deck.name}” (${plural(r.removedCards, "card")}).`);
  };

  const n = (v: number, cls: string) => <span className={v ? cls : "zero"}>{v}</span>;

  return (
    <tr className={picked || covered ? "is-picked" : ""}>
      <td className="col-pick">
        <input
          type="checkbox"
          checked={picked || covered}
          disabled={covered}
          onChange={onPick}
          aria-label={`Study ${deck.fullName} with other decks`}
          title={covered ? "Included with its parent deck" : "Pick to study with other decks"}
        />
      </td>
      <td className="deck-name">
        <div className="deck-name-inner" style={{ paddingLeft: depth * 20 }}>
          {deck.children.length ? (
            <button className={`deck-toggle ${open ? "open" : ""}`} onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
              <Chevron width={12} height={12} />
            </button>
          ) : (
            <span className="deck-toggle-spacer" />
          )}
          {renaming ? (
            <input
              className="input"
              autoFocus
              defaultValue={deck.fullName}
              onBlur={(e) => void rename(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename((e.target as HTMLInputElement).value.trim());
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <a href={`/deck/${deck.id}`}>{deck.name}</a>
          )}
        </div>
      </td>
      <td>{n(deck.new, "c-new")}</td>
      <td>{n(deck.learn, "c-learn")}</td>
      <td>{n(deck.review, "c-due")}</td>
      <td className="col-menu">
        <button
          className="icon-btn row-menu-btn"
          aria-label="Deck options"
          aria-expanded={menu}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(!menu);
          }}
        >
          <More />
        </button>
        {menu && (
          <div className="menu" style={{ right: 8, top: 36 }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => navigate(`/study/${deck.id}`)}>Study now</button>
            <button onClick={() => navigate(`/add?deck=${deck.id}`)}>Add cards</button>
            <button onClick={() => navigate(`/browse?deck=${encodeURIComponent(deck.fullName)}`)}>Browse</button>
            <button onClick={() => navigate(`/deck/${deck.id}`)}>Options</button>
            <hr />
            <button onClick={() => (setMenu(false), setRenaming(true))}>Rename</button>
            <button className="danger" onClick={() => (setMenu(false), void remove())}>
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
