import { memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BulkAction, DeckNode, Row } from "../api";
import { CardHtml } from "../components/CardHtml";
import { CardPanel, FlagPicker } from "../components/CardPanel";
import { DeckSelect } from "../components/DeckSelect";
import { SearchBox, SearchBoxHandle } from "../components/SearchBox";
import { plural } from "../lib/format";
import { useDebounced, useLocalStorage } from "../lib/hooks";
import { isTyping, useKeys } from "../lib/keys";
import { hasTerm, quoteIfNeeded, tokenize, toggleTerm } from "../lib/query";
import { navigate, useLocation } from "../lib/router";
import { decks as decksStore, invalidate, settings as settingsStore, vocab as vocabStore } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo, onUndo } from "../lib/undo";

const ORDERS = [
  { key: "added", label: "date added" },
  { key: "modified", label: "last edited" },
  { key: "due", label: "due date" },
  { key: "interval", label: "interval" },
  { key: "difficulty", label: "difficulty" },
  { key: "lapses", label: "lapses" },
  { key: "reviews", label: "reviews" },
  { key: "sortfield", label: "alphabetical" },
];

const STATES: { term: string; label: string }[] = [
  { term: "is:due", label: "Due today" },
  { term: "is:new", label: "New" },
  { term: "is:learn", label: "Learning" },
  { term: "is:fragile", label: "Slipping away" },
  { term: "is:hard", label: "Hard" },
  { term: "is:flagged", label: "Flagged" },
  { term: "is:suspended", label: "Suspended" },
  { term: "has:image", label: "With an image" },
  { term: "is:fresh", label: "Added today" },
  { term: "is:today", label: "Reviewed today" },
  { term: "rated:7:1", label: "Forgotten this week" },
];

const PAGE = 60;

export function Browse() {
  const { params } = useLocation();
  const urlQuery = params.get("q") ?? "";
  const [text, setText] = useState(urlQuery);
  const query = useDebounced(text, 110);
  const [order, setOrder] = useLocalStorage("browse.order", "added");
  const [desc, setDesc] = useLocalStorage("browse.desc", true);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const seq = useRef(0);
  const search = useRef<SearchBoxHandle>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const deckData = decksStore.use();
  const vocab = vocabStore.use();
  const settings = settingsStore.use();

  // Follow the URL when it changes from elsewhere (e.g. a tag link).
  useEffect(() => setText(urlQuery), [urlQuery]);
  useEffect(() => {
    if (query !== urlQuery) navigate(query ? `/browse?q=${encodeURIComponent(query)}` : "/browse", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchRows = useCallback(
    async (offset: number, limit = PAGE) => {
      const id = ++seq.current;
      setLoading(true);
      const r = await api.search(query, order, desc, offset, limit);
      if (id !== seq.current) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      setTotal(r.total);
      setMs(r.ms);
      setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
    },
    [query, order, desc],
  );

  useEffect(() => {
    void fetchRows(0);
    setSelected(new Set());
  }, [fetchRows]);

  const refreshAll = useCallback(() => fetchRows(0, Math.max(PAGE, rows.length)), [fetchRows, rows.length]);
  useEffect(() => onUndo(() => void refreshAll()), [refreshAll]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && rows.length < total) void fetchRows(rows.length);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, total, loading, fetchRows]);

  const focusIndex = rows.findIndex((r) => r.id === focus);

  const refreshRow = useCallback(
    async (cardId: number, structural?: boolean) => {
      if (structural) {
        setFocus(null);
        void refreshAll();
        return;
      }
      const r = await api.search(`cid:${cardId}`, "added", true, 0, 1);
      if (r.ok && r.rows[0]) setRows((prev) => prev.map((row) => (row.id === cardId ? r.rows[0] : row)));
      invalidate();
    },
    [refreshAll],
  );

  const select = (e: MouseEvent, index: number) => {
    const id = rows[index].id;
    if (e.shiftKey && anchor.current !== null) {
      const a = rows.findIndex((r) => r.id === anchor.current);
      const [lo, hi] = a < index ? [a, index] : [index, a];
      const next = new Set(selected);
      for (let i = lo; i <= hi; i++) next.add(rows[i].id);
      setSelected(next);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      anchor.current = id;
      return;
    }
    anchor.current = id;
    setFocus(id);
  };

  const move = (delta: number) => {
    if (!rows.length) return;
    const i = focusIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, focusIndex + delta));
    setFocus(rows[i].id);
    anchor.current = rows[i].id;
    listRef.current?.children[i]?.scrollIntoView({ block: "nearest" });
  };

  useKeys((e) => {
    if (e.key === "/" && !isTyping(e)) {
      search.current?.focus();
      return true;
    }
    if (isTyping(e)) {
      if (e.key === "Escape" && (e.target as HTMLElement).closest(".card-panel")) {
        (document.activeElement as HTMLElement | null)?.blur();
        return true;
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      setSelected(new Set(rows.map((r) => r.id)));
      return true;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "j":
      case "ArrowDown":
        move(1);
        return true;
      case "k":
      case "ArrowUp":
        move(-1);
        return true;
      case "x":
        if (focus !== null) {
          const next = new Set(selected);
          if (next.has(focus)) next.delete(focus);
          else next.add(focus);
          setSelected(next);
        }
        return true;
      case "Enter":
        document.querySelector<HTMLElement>(".card-panel .cm-content")?.focus();
        return true;
      case "Escape":
        if (selected.size) setSelected(new Set());
        else setFocus(null);
        return true;
      case "s": {
        const row = rows[focusIndex];
        if (row) void runBulk([row.id], row.due.state === "suspended" ? "unsuspend" : "suspend");
        return true;
      }
    }
  });

  const runBulk = async (ids: number[], action: BulkAction, extra: Record<string, unknown> = {}) => {
    try {
      const r = await api.bulk(ids, action, extra);
      const what: Record<BulkAction, string> = {
        suspend: "Suspended",
        unsuspend: "Unsuspended",
        bury: "Buried",
        unbury: "Unburied",
        delete: "Deleted",
        move: "Moved",
        addTags: "Tagged",
        removeTags: "Untagged",
        flag: "Flagged",
        forget: "Reset",
        setDue: "Rescheduled",
      };
      doneWithUndo(`${what[action]} ${plural(r.count, "card")}.`);
      invalidate();
      if (action === "delete") setFocus(null);
      void refreshAll();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const setDeckFilter = (fullName: string) => {
    const deckTerm = quoteIfNeeded(`deck:${fullName}`);
    const kept = tokenize(text)
      .filter((t) => !/^-?"?(deck:|@)/i.test(t.raw))
      .map((t) => t.raw)
      .join(" ");
    const current = tokenize(text).find((t) => t.raw.toLowerCase() === deckTerm.toLowerCase());
    setText(current ? kept : `${deckTerm} ${kept}`.trim());
  };

  const saveSearch = async () => {
    const name = window.prompt("Name this search", text.slice(0, 40));
    if (!name || !settings) return;
    await api.saveSettings({ savedSearches: [...settings.savedSearches, { name, query: text }] });
    void settingsStore.refresh();
    toast.success(`Saved “${name}” to your shelf.`);
  };

  const removeSaved = async (i: number) => {
    if (!settings) return;
    await api.saveSettings({ savedSearches: settings.savedSearches.filter((_, j) => j !== i) });
    void settingsStore.refresh();
  };

  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <div className={`browse ${focus !== null ? "has-panel" : ""}`}>
      <aside className="facets" aria-label="Filters">
        <section>
          <h3 className="smallcaps">Shelf</h3>
          <ul className="facet-list">
            {(settings?.savedSearches ?? []).map((s, i) => (
              <li key={s.name + i} className={text.trim() === s.query ? "on" : ""}>
                <button onClick={() => setText(text.trim() === s.query ? "" : s.query)} title={s.query}>
                  {s.name}
                </button>
                <button className="facet-x" onClick={() => void removeSaved(i)} aria-label={`Remove ${s.name}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="smallcaps">State</h3>
          <ul className="facet-list">
            {STATES.map((s) => (
              <li key={s.term} className={hasTerm(text, s.term) ? "on" : ""}>
                <button onClick={() => setText(toggleTerm(text, s.term))}>{s.label}</button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="smallcaps">Decks</h3>
          <DeckFacet nodes={deckData?.decks ?? []} text={text} onPick={setDeckFilter} />
        </section>
        <section>
          <h3 className="smallcaps">Tags</h3>
          <ul className="facet-list facet-tags">
            {(vocab?.tags ?? []).map((t) => (
              <li key={t} className={hasTerm(text, "#" + t) ? "on" : ""}>
                <button onClick={() => setText(toggleTerm(text, "#" + quoteIfNeeded(t)))}>#{t}</button>
              </li>
            ))}
            {vocab && !vocab.tags.length && <li className="margin-quiet">No tags yet.</li>}
          </ul>
        </section>
      </aside>

      <section className="results" aria-label="Cards">
        <SearchBox
          ref={search}
          value={text}
          onChange={setText}
          error={error}
          onSubmit={() => rows[0] && (setFocus(rows[0].id), listRef.current?.focus())}
          extra={
            text.trim() && !settings?.savedSearches.some((s) => s.query === text.trim()) ? (
              <button className="search-save" onClick={() => void saveSearch()} title="Keep this search on your shelf">
                ☆
              </button>
            ) : null
          }
        />
        <div className="results-meta">
          <span>
            {plural(total, "card")}
            {ms !== null && <span className="results-ms"> · {ms < 1 ? "<1" : Math.round(ms)} ms</span>}
          </span>
          <label className="sort">
            sorted by
            <select value={order} onChange={(e) => setOrder(e.target.value)}>
              {ORDERS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button className="icon-button" onClick={() => setDesc(!desc)} title={desc ? "Descending" : "Ascending"}>
              {desc ? "↓" : "↑"}
            </button>
          </label>
        </div>

        <ol className="result-list" ref={listRef} tabIndex={-1}>
          {rows.map((row, i) => (
            <ResultRow
              key={row.id}
              row={row}
              focused={row.id === focus}
              selected={selected.has(row.id)}
              onClick={(e) => select(e, i)}
              onToggle={() => {
                const next = new Set(selected);
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                setSelected(next);
                anchor.current = row.id;
              }}
            />
          ))}
        </ol>
        <div ref={sentinel} className="sentinel" />
        {!loading && !error && rows.length === 0 && (
          <div className="empty">
            <p>No cards match.</p>
            <p className="margin-quiet">Even Ebbinghaus forgot things sometimes. Try removing a clause above.</p>
          </div>
        )}

        {selected.size > 0 && (
          <BulkBar ids={selectedIds} onRun={runBulk} onClear={() => setSelected(new Set())} />
        )}
      </section>

      {focus !== null && <CardPanel key="panel" cardId={focus} onChanged={refreshRow} onClose={() => setFocus(null)} />}
    </div>
  );
}

const ResultRow = memo(function ResultRow({
  row,
  focused,
  selected,
  onClick,
  onToggle,
}: {
  row: Row;
  focused: boolean;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
  onToggle: () => void;
}) {
  const r = row.memory?.retrievability;
  const deckLeaf = row.deck.split("::").slice(-1)[0];
  return (
    <li
      className={`result ${focused ? "is-focused" : ""} ${selected ? "is-selected" : ""} state-${row.due.state}`}
      onClick={onClick}
      aria-selected={focused}
    >
      <input
        type="checkbox"
        className="result-check"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select card"
      />
      <div className="result-body">
        <CardHtml html={row.question} className="result-q" />
        {row.answer && <CardHtml html={row.answer} className="result-a" />}
        <div className="result-meta">
          {row.flag > 0 && <span className={`flag-dot flag-${row.flag} on small`} />}
          <span className="result-deck" title={row.deck}>
            {deckLeaf}
          </span>
          <span className={`result-due due-${row.due.state}`}>
            {row.due.state === "suspended" ? "suspended" : row.due.state === "buried" ? "buried" : row.due.label}
          </span>
          {r != null && (
            <span className="result-recall" title={`Recall odds now: ${Math.round(r * 100)}%`}>
              <span className="mini-gauge">
                <span style={{ width: `${Math.round(r * 100)}%` }} className={r < 0.8 ? "low" : ""} />
              </span>
            </span>
          )}
          {row.tags.slice(0, 3).map((t) => (
            <span key={t} className="result-tag">
              #{t}
            </span>
          ))}
          {row.tags.length > 3 && <span className="result-tag">+{row.tags.length - 3}</span>}
        </div>
      </div>
    </li>
  );
});

function DeckFacet({ nodes, text, onPick, depth = 0 }: { nodes: DeckNode[]; text: string; onPick: (n: string) => void; depth?: number }) {
  return (
    <ul className={`facet-list facet-decks depth-${depth}`}>
      {nodes.map((d) => (
        <li key={d.id} className={hasTerm(text, quoteIfNeeded(`deck:${d.fullName}`)) ? "on" : ""}>
          <button onClick={() => onPick(d.fullName)}>
            {d.name}
            <span className="facet-count">{d.total}</span>
          </button>
          {d.children.length > 0 && <DeckFacet nodes={d.children} text={text} onPick={onPick} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function BulkBar({ ids, onRun, onClear }: { ids: number[]; onRun: (ids: number[], a: BulkAction, extra?: Record<string, unknown>) => Promise<void>; onClear: () => void }) {
  const [mode, setMode] = useState<null | "move" | "tag" | "untag" | "flag">(null);
  const [tagText, setTagText] = useState("");
  const run = async (a: BulkAction, extra?: Record<string, unknown>) => {
    await onRun(ids, a, extra);
    setMode(null);
    setTagText("");
  };
  return (
    <div className="bulkbar" role="toolbar" aria-label="Selected cards">
      <span className="bulk-count">{plural(ids.length, "card")} selected</span>
      {mode === "move" ? (
        <DeckSelect value={null} label="to" onChange={(id) => void run("move", { deckId: id })} />
      ) : mode === "tag" || mode === "untag" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tagText.trim()) void run(mode === "tag" ? "addTags" : "removeTags", { tags: tagText.trim() });
          }}
        >
          <input autoFocus value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder={mode === "tag" ? "tags to add" : "tags to remove"} />
        </form>
      ) : mode === "flag" ? (
        <FlagPicker value={-1} onChange={(f) => void run("flag", { flag: f })} />
      ) : (
        <>
          <button onClick={() => setMode("move")}>Move…</button>
          <button onClick={() => setMode("tag")}>Tag…</button>
          <button onClick={() => setMode("untag")}>Untag…</button>
          <button onClick={() => setMode("flag")}>Flag…</button>
          <button onClick={() => void run("suspend")}>Suspend</button>
          <button onClick={() => void run("unsuspend")}>Unsuspend</button>
          <button onClick={() => void run("forget")}>Forget</button>
          <button className="danger" onClick={() => void run("delete")}>
            Delete
          </button>
        </>
      )}
      <button className="bulk-clear" onClick={mode ? () => setMode(null) : onClear}>
        {mode ? "back" : "clear"}
      </button>
    </div>
  );
}
