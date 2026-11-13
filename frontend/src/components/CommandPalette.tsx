import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { rank } from "../lib/fuzzy";
import { navigate } from "../lib/router";
import { decks, flattenDecks } from "../lib/store";
import { cycleTheme } from "../lib/theme";
import { redoLast, undoLast } from "../lib/undo";

interface Command {
  id: string;
  title: string;
  hint?: string;
  section: string;
  run: () => void;
}

export function CommandPalette({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const deckData = decks.use();

  useEffect(() => input.current?.focus(), []);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "home", title: "Decks", hint: "D", section: "Go to", run: () => navigate("/") },
      { id: "add", title: "Add card", hint: "A", section: "Go to", run: () => navigate("/add") },
      { id: "browse", title: "Browse", hint: "B", section: "Go to", run: () => navigate("/browse") },
      { id: "stats", title: "Stats", hint: "T", section: "Go to", run: () => navigate("/stats") },
      { id: "settings", title: "Settings", section: "Go to", run: () => navigate("/settings") },
      { id: "theme", title: "Toggle theme", section: "Action", run: cycleTheme },
      { id: "undo", title: "Undo", hint: "⌘Z", section: "Action", run: () => void undoLast() },
      { id: "redo", title: "Redo", hint: "⇧⌘Z", section: "Action", run: () => void redoLast() },
      { id: "help", title: "Keyboard shortcuts", hint: "?", section: "Action", run: onHelp },
    ];
    const totals = deckData?.totals;
    const dueAll = totals ? totals.new + totals.learn + totals.review : 0;
    base.push({
      id: "study-all",
      title: "Study all decks",
      hint: dueAll ? `${dueAll} due` : undefined,
      section: "Deck",
      run: () => navigate("/study/all"),
    });
    for (const d of flattenDecks(deckData?.decks ?? [])) {
      const due = d.new + d.learn + d.review;
      base.push({
        id: `study-${d.id}`,
        title: `Study ${d.fullName.replace(/::/g, " › ")}`,
        hint: due ? `${due} due` : undefined,
        section: "Deck",
        run: () => navigate(`/study/${d.id}`),
      });
      base.push({
        id: `browse-${d.id}`,
        title: `Browse ${d.fullName.replace(/::/g, " › ")}`,
        section: "Deck",
        run: () => navigate(`/browse?deck=${encodeURIComponent(d.fullName)}`),
      });
      base.push({
        id: `add-${d.id}`,
        title: `Add card to ${d.fullName.replace(/::/g, " › ")}`,
        section: "Deck",
        run: () => navigate(`/add?deck=${d.id}`),
      });
    }
    return base;
  }, [deckData, onHelp]);

  const results = useMemo(() => {
    const ranked = text ? rank(commands, text, (c) => c.title, 12) : commands.filter((c) => c.section !== "Deck" || c.hint).slice(0, 12);
    if (text.trim()) {
      ranked.push({
        id: "search-text",
        title: `Search cards for “${text.trim()}”`,
        section: "Search",
        run: () => navigate(`/browse?text=${encodeURIComponent(text.trim())}`),
      });
    }
    return ranked;
  }, [commands, text]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    }
  };

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          value={text}
          placeholder="Type a command, deck or search…"
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          aria-label="Command"
        />
        <ul className="palette-list" role="listbox">
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span className="palette-section">{c.section}</span>
              <span className="palette-title">{c.title}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </li>
          ))}
          {!results.length && <li className="palette-empty">Nothing by that name.</li>}
        </ul>
      </div>
    </div>
  );
}
