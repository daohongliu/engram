import { forwardRef, KeyboardEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { currentToken, parseQuery, removeToken, Suggestion, suggest } from "../lib/query";
import { vocab as vocabStore } from "../lib/store";

export interface SearchBoxHandle {
  focus: () => void;
}

/**
 * The search input, its completions, and an English reading of the query
 * underneath, where each clause is a chip you can remove or negate.
 */
export const SearchBox = forwardRef<SearchBoxHandle, {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  onEscape?: () => void;
  onSubmit?: () => void;
  extra?: React.ReactNode;
}>(function SearchBox({ value, onChange, error, onEscape, onSubmit, extra }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const vocab = vocabStore.use();
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  // After accepting a suggestion, put the caret right after the inserted
  // text before the browser handles the next key press.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && input.current) {
      input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const token = useMemo(() => currentToken(value, caret), [value, caret]);
  const suggestions = useMemo<Suggestion[]>(() => (open ? suggest(token.text, vocab) : []), [open, token.text, vocab]);
  const terms = useMemo(() => parseQuery(value), [value]);

  const accept = (s: Suggestion) => {
    const before = value.slice(0, token.start);
    const after = value.slice(token.end);
    const needsSpace = !s.insert.endsWith(":");
    const next = before + s.insert + (needsSpace && !after.startsWith(" ") ? " " : "") + after.trimStart();
    pendingCaret.current = before.length + s.insert.length + (needsSpace ? 1 : 0);
    onChange(next);
    setActive(0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && suggestions[active])) {
        e.preventDefault();
        accept(suggestions[Math.min(active, suggestions.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape") {
      if (suggestions.length) setOpen(false);
      else {
        input.current?.blur();
        onEscape?.();
      }
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      onSubmit?.();
    }
  };

  const negate = (start: number, end: number) => {
    const raw = value.slice(start, end);
    const flipped = raw.startsWith("-") ? raw.slice(1) : "-" + raw;
    onChange(value.slice(0, start) + flipped + value.slice(end));
  };

  return (
    <div className="searchbox">
      <div className="search-field">
        <span className="search-glyph" aria-hidden>
          ⌕
        </span>
        <input
          ref={input}
          className="search-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="Search…  try  @analysis #theorem is:due"
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setOpen(true);
            setActive(0);
          }}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          aria-label="Search cards"
          aria-autocomplete="list"
        />
        {value && (
          <button className="search-clear" onClick={() => onChange("")} aria-label="Clear search">
            ×
          </button>
        )}
        {extra}
        {suggestions.length > 0 && (
          <ul className="popover-list search-suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.insert}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
              >
                <span className="sugg-label">{s.label}</span>
                {s.hint && <span className="sugg-hint">{s.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className={`query-sentence ${error ? "has-error" : ""}`}>
        {error ? (
          <span className="query-error">
            Hmm. {error.replace(/^Invalid search: /, "").replace(/^./, (c) => c.toUpperCase())}
          </span>
        ) : terms.length === 0 ? (
          <span className="margin-quiet">Showing every card in the collection.</span>
        ) : (
          <>
            <span className="margin-quiet">Cards </span>
            {terms.map((t, i) =>
              t.kind === "term" ? (
                <span key={i} className={`query-chip ${t.negated ? "is-negated" : ""}`}>
                  <button className="chip-text" title={t.negated ? "Click to include" : "Click to exclude"} onClick={() => negate(t.start, t.end)}>
                    {t.negated && <span className="chip-not">not </span>}
                    {t.phrase}
                  </button>
                  <button className="chip-x" aria-label={`Remove ${t.phrase}`} onClick={() => onChange(removeToken(value, t))}>
                    ×
                  </button>
                </span>
              ) : (
                <span key={i} className="query-joiner">
                  {t.kind === "or" ? " or " : t.kind === "and" ? " and " : t.phrase}
                </span>
              ),
            )}
          </>
        )}
      </p>
    </div>
  );
});
