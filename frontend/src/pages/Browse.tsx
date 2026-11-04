import { memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BulkAction, DeckNode, Row } from "../api";
import { CardHtml } from "../components/CardHtml";
import { CardPanel, FLAG_NAMES } from "../components/CardPanel";
import { DeckSelect } from "../components/DeckSelect";
import { ArrowDown, ArrowUp, Chevron, Close, Search } from "../components/Icons";
import { plural } from "../lib/format";
import { useDebounced, useLocalStorage } from "../lib/hooks";
import { isTyping, useKeys } from "../lib/keys";
import { navigate, useLocation } from "../lib/router";
import { decks as decksStore, invalidate, tags as tagsStore } from "../lib/store";
import { toast } from "../lib/toast";
import { doneWithUndo, onUndo } from "../lib/undo";

const STATES: { key: string; label: string }[] = [
  { key: "due", label: "Due today" },
  { key: "new", label: "New" },
  { key: "learning", label: "Learning" },
  { key: "review", label: "Review" },
  { key: "suspended", label: "Suspended" },
  { key: "buried", label: "Buried" },
  { key: "flagged", label: "Flagged" },
  { key: "image", label: "Has image" },
  { key: "difficult", label: "Difficult" },
  { key: "forgotten", label: "Forgotten this week" },
  { key: "added-today", label: "Added today" },
  { key: "reviewed-today", label: "Reviewed today" },
];

const COLUMNS = [
  { key: "sortfield", label: "Question", sort: "sortfield", width: undefined },
  { key: "answer", label: "Answer", sort: null, width: undefined },
  { key: "deck", label: "Deck", sort: null, width: 140 },
  { key: "due", label: "Due", sort: "due", width: 110 },
  { key: "interval", label: "Interval", sort: "interval", width: 84 },
  { key: "reviews", label: "Reviews", sort: "reviews", width: 80 },
  { key: "added", label: "Added", sort: "added", width: 96 },
] as const;

const PAGE = 100;

const EXTRA: string[] = ["interval", "reviews", "added"];
const colClass = (key: string) => (EXTRA.includes(key) || key === "deck" ? "col-hide-sm" : "");

export function Browse() {
  const { params } = useLocation();
  const deck = params.get("deck");
  const tag = params.get("tag");
  const state = params.get("state");
  const urlText = params.get("text") ?? "";
  const [text, setText] = useState(urlText);
  const query = useDebounced(text, 120);
  const [order, setOrder] = useLocalStorage("browse.order", "added");
  const [desc, setDesc] = useLocalStorage("browse.desc", true);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const seq = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const sentinel = useRef<HTMLTableRowElement>(null);
  const deckData = decksStore.use();
  const allTags = tagsStore.use();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    navigate(qs ? `/browse?${qs}` : "/browse", { replace: true });
  };

  useEffect(() => setText(urlText), [urlText]);
  useEffect(() => {
    if (query !== urlText) setParam("text", query || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchRows = useCallback(
    async (offset: number, limit = PAGE) => {
      const id = ++seq.current;
      setLoading(true);
      try {
        const r = await api.search({ text: query, deck, tag, state, order, desc, offset, limit });
        if (id !== seq.current) return;
        setTotal(r.total);
        setMs(r.ms);
        setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [query, deck, tag, state, order, desc],
  );

  useEffect(() => {
    void fetchRows(0);
    setSelected(new Set());
  }, [fetchRows]);

  const refreshAll = useCallback(() => fetchRows(0, Math.max(PAGE, rows.length)), [fetchRows, rows.length]);
  useEffect(() => onUndo(() => void refreshAll()), [refreshAll]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && rows.length < total) void fetchRows(rows.length);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, total, loading, fetchRows]);

  const refreshRow = useCallback(
    async (cardId: number, removed?: boolean) => {
      if (removed) {
        setCurrent(null);
        void refreshAll();
        return;
      }
      const r = await api.search({ cid: cardId, limit: 1 });
      if (r.rows[0]) setRows((prev) => prev.map((row) => (row.id === cardId ? r.rows[0] : row)));
      invalidate();
    },
    [refreshAll],
  );

  const currentIndex = rows.findIndex((r) => r.id === current);

  const onRowClick = (e: MouseEvent, index: number) => {
    const id = rows[index].id;
    if (e.shiftKey && anchor.current !== null) {
      const a = rows.findIndex((r) => r.id === anchor.current);
      const [lo, hi] = a < index ? [a, index] : [index, a];
      setSelected(new Set(rows.slice(lo, hi + 1).map((r) => r.id)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected.size ? selected : current !== null ? [current] : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      anchor.current = id;
      return;
    }
    anchor.current = id;
    setSelected(new Set());
    setCurrent(id);
  };

  const move = (delta: number) => {
    if (!rows.length) return;
    const i = currentIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
    setCurrent(rows[i].id);
    anchor.current = rows[i].id;
    setSelected(new Set());
    tbody.current?.children[i]?.scrollIntoView({ block: "nearest" });
  };

  useKeys((e) => {
    if (e.key === "/" && !isTyping(e)) {
      searchInput.current?.focus();
      searchInput.current?.select();
      return true;
    }
    if (isTyping(e)) {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        return true;
      }
      if (e.target === searchInput.current && (e.key === "ArrowDown" || e.key === "Enter")) {
        searchInput.current?.blur();
        move(currentIndex < 0 ? 0 : 1);
        return true;
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      setSelected(new Set(rows.map((r) => r.id)));
      return true;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowDown" || e.key === "j") return move(1), true;
    if (e.key === "ArrowUp" || e.key === "k") return move(-1), true;
    if (e.key === "Enter") {
      document.querySelector<HTMLElement>(".editor-pane .cm-content")?.focus();
      return true;
    }
    if (e.key === "Escape") {
      if (selected.size) setSelected(new Set());
      else setCurrent(null);
      return true;
    }
  });

  const runBulk = async (ids: number[], action: BulkAction, extra: Record<string, unknown> = {}) => {
    try {
      const r = await api.bulk(ids, action, extra);
      const verb: Record<BulkAction, string> = {
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
      doneWithUndo(`${verb[action]} ${plural(r.count, "card")}.`);
      invalidate();
      if (action === "delete") setCurrent(null);
      setSelected(new Set());
      void refreshAll();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const sortBy = (key: string) => {
    if (order === key) setDesc(!desc);
    else {
      setOrder(key);
      setDesc(key === "added" || key === "reviews" || key === "interval");
    }
  };

  const filters = [
    deck && { key: "deck", label: deck.split("::").join(" › ") },
    tag && { key: "tag", label: `Tag: ${tag}` },
    state && { key: "state", label: STATES.find((s) => s.key === state)?.label ?? state },
  ].filter(Boolean) as { key: string; label: string }[];

  const selectedIds = useMemo(() => [...selected], [selected]);
  const compact = current !== null;
  const columns = compact ? COLUMNS.filter((c) => !EXTRA.includes(c.key)) : COLUMNS;

  return (
    <div className={`browse ${current !== null ? "has-editor" : ""}`}>
      <aside className="sidebar" aria-label="Filters">
        <div className="sidebar-section">
          <button className={`side-item ${!deck && !tag && !state ? "on" : ""}`} onClick={() => navigate(text ? `/browse?text=${encodeURIComponent(text)}` : "/browse", { replace: true })}>
            <span className="grow">All cards</span>
          </button>
        </div>
        <div className="sidebar-section">
          <span className="label">Cards</span>
          {STATES.map((s) => (
            <button key={s.key} className={`side-item ${state === s.key ? "on" : ""}`} onClick={() => setParam("state", state === s.key ? null : s.key)}>
              <span className="grow">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-section">
          <span className="label">Decks</span>
          <DeckTree nodes={deckData?.decks ?? []} active={deck} onPick={(name) => setParam("deck", deck === name ? null : name)} />
        </div>
        <div className="sidebar-section">
          <span className="label">Tags</span>
          {(allTags ?? []).map((t) => (
            <button key={t.name} className={`side-item ${tag === t.name ? "on" : ""}`} onClick={() => setParam("tag", tag === t.name ? null : t.name)}>
              <span className="grow">{t.name}</span>
              <span className="count">{t.notes}</span>
            </button>
          ))}
          {allTags && !allTags.length && <p className="muted" style={{ padding: "0 10px", fontSize: 12 }}>No tags</p>}
        </div>
      </aside>

      <section className="results">
        <div className="results-toolbar">
          <div className="search">
            <Search />
            <input
              ref={searchInput}
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search cards"
              spellCheck={false}
              aria-label="Search cards"
            />
          </div>
          {filters.map((f) => (
            <span key={f.key} className="filter-chip">
              {f.label}
              <button onClick={() => setParam(f.key, null)} aria-label={`Remove filter ${f.label}`}>
                <Close width={12} height={12} />
              </button>
            </span>
          ))}
          <span className="results-meta">
            {plural(total, "card")}
            {ms !== null && <span>· {ms < 1 ? "<1" : Math.round(ms)} ms</span>}
          </span>
        </div>

        {selected.size > 0 && <BulkToolbar ids={selectedIds} onRun={runBulk} onClear={() => setSelected(new Set())} />}

        <div className="table-wrap">
          <table className="card-table">
            <colgroup>
              <col style={{ width: 40 }} />
              {columns.map((c) => (
                <col key={c.key} className={colClass(c.key)} style={c.width ? { width: c.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`${c.sort ? "sortable" : ""} ${c.sort === order ? "sorted" : ""} ${colClass(c.key)}`}
                    onClick={c.sort ? () => sortBy(c.sort!) : undefined}
                  >
                    {c.label}{" "}
                    {c.sort === order && (desc ? <ArrowDown width={11} height={11} /> : <ArrowUp width={11} height={11} />)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={tbody}>
              {rows.map((row, i) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  current={row.id === current}
                  compact={compact}
                  selected={selected.has(row.id)}
                  onClick={(e) => onRowClick(e, i)}
                  onToggle={() => {
                    const next = new Set(selected);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    setSelected(next);
                    anchor.current = row.id;
                  }}
                />
              ))}
              <tr ref={sentinel} />
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <div className="empty-state">
              <h2>No matching cards</h2>
              <p>{text || filters.length ? "Try fewer words or remove a filter." : "Add some cards to see them here."}</p>
            </div>
          )}
          {rows.length > 0 && rows.length >= total && total > 20 && <div className="table-foot">{plural(total, "card")}</div>}
        </div>
      </section>

      {current !== null && <CardPanel cardId={current} onChanged={refreshRow} onClose={() => setCurrent(null)} />}
    </div>
  );
}

const ResultRow = memo(function ResultRow({
  row,
  current,
  compact,
  selected,
  onClick,
  onToggle,
}: {
  row: Row;
  current: boolean;
  compact: boolean;
  selected: boolean;
  onClick: (e: MouseEvent) => void;
  onToggle: () => void;
}) {
  const suspended = row.due.state === "suspended";
  const dueText = suspended ? "Suspended" : row.due.state === "buried" ? "Buried" : row.due.label === "new" ? "New" : row.due.label;
  return (
    <tr className={`${current ? "is-current" : ""} ${selected ? "is-selected" : ""} ${suspended ? "is-suspended" : ""}`} onClick={onClick}>
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Select card" />
      </td>
      <td>
        <div className="cell-html">
          {row.flag > 0 && <span className="cell-flag" style={{ ["--c" as string]: `var(--flag-${row.flag})` }} title={`${FLAG_NAMES[row.flag]} flag`} />}
          <CardHtml html={row.question} inline />
        </div>
      </td>
      <td>
        <div className="cell-html cell-answer">
          <CardHtml html={row.answer} inline />
        </div>
      </td>
      <td className="cell-muted col-hide-sm" title={row.deck}>
        {row.deck.split("::").slice(-1)[0]}
      </td>
      <td className={row.due.days !== null && row.due.days < 0 ? "c-learn" : "cell-muted"}>{dueText}</td>
      {!compact && (
        <>
          <td className="cell-muted num col-hide-sm">{row.interval > 0 ? `${row.interval}d` : "—"}</td>
          <td className="cell-muted num col-hide-sm">{row.reps}</td>
          <td className="cell-muted num col-hide-sm">{new Date(row.id).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}</td>
        </>
      )}
    </tr>
  );
});

function DeckTree({ nodes, active, onPick, depth = 0 }: { nodes: DeckNode[]; active: string | null; onPick: (n: string) => void; depth?: number }) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  return (
    <div className={depth ? "side-children" : ""}>
      {nodes.map((d) => (
        <div key={d.id}>
          <button className={`side-item ${active === d.fullName ? "on" : ""}`} onClick={() => onPick(d.fullName)}>
            {d.children.length ? (
              <span
                className={`deck-toggle ${closed.has(d.id) ? "" : "open"}`}
                style={{ width: 16, height: 16, marginLeft: -6 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Set(closed);
                  if (next.has(d.id)) next.delete(d.id);
                  else next.add(d.id);
                  setClosed(next);
                }}
              >
                <Chevron width={10} height={10} />
              </span>
            ) : (
              <span style={{ width: 10 }} />
            )}
            <span className="grow">{d.name}</span>
            <span className="count">{d.total}</span>
          </button>
          {d.children.length > 0 && !closed.has(d.id) && <DeckTree nodes={d.children} active={active} onPick={onPick} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function BulkToolbar({ ids, onRun, onClear }: { ids: number[]; onRun: (ids: number[], a: BulkAction, extra?: Record<string, unknown>) => Promise<void>; onClear: () => void }) {
  const [mode, setMode] = useState<null | "move" | "tag" | "untag">(null);
  const [value, setValue] = useState("");
  const run = async (a: BulkAction, extra?: Record<string, unknown>) => {
    await onRun(ids, a, extra);
    setMode(null);
    setValue("");
  };
  return (
    <div className="bulk-toolbar" role="toolbar" aria-label="Selected cards">
      <strong>{plural(ids.length, "card")} selected</strong>
      {mode === "move" ? (
        <>
          <DeckSelect value={null} onChange={(id) => void run("move", { deckId: id })} />
          <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>
            Cancel
          </button>
        </>
      ) : mode ? (
        <form
          style={{ display: "flex", gap: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void run(mode === "tag" ? "addTags" : "removeTags", { tags: value.trim() });
          }}
        >
          <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "tag" ? "Tags to add" : "Tags to remove"} />
          <button className="btn btn-sm btn-primary" type="submit">
            {mode === "tag" ? "Add" : "Remove"}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode("move")}>
            Change deck
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode("tag")}>
            Add tags
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode("untag")}>
            Remove tags
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void run("suspend")}>
            Suspend
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void run("unsuspend")}>
            Unsuspend
          </button>
          <select className="select" value="" onChange={(e) => void run("flag", { flag: Number(e.target.value) })} aria-label="Flag">
            <option value="" disabled>
              Flag…
            </option>
            {FLAG_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => void run("forget")}>
            Reset to new
          </button>
          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => void run("delete")}>
            Delete
          </button>
        </>
      )}
      <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
