import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { extractFootnotes } from "../lib/html";
import { CardHtml } from "./CardHtml";

interface Note {
  id: string;
  label: string;
  html: string;
}

/**
 * Card HTML whose Markdown footnotes are lifted into the right margin,
 * each one level with the line that cites it (Tufte-style sidenotes).
 * On narrow screens the CSS drops them below the text instead.
 */
export function Sidenoted({ html, className = "" }: { html: string; className?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const body = useRef<HTMLDivElement | null>(null);
  const aside = useRef<HTMLDivElement>(null);

  const onReady = useCallback((el: HTMLDivElement) => {
    body.current = el;
    setNotes(extractFootnotes(el));
  }, []);

  useLayoutEffect(() => {
    const place = () => {
      const root = body.current;
      const side = aside.current;
      if (!root || !side) return;
      const base = side.getBoundingClientRect().top;
      let floor = 0;
      for (const noteEl of side.querySelectorAll<HTMLElement>(".sidenote")) {
        const ref = root.querySelector<HTMLElement>(`[data-note="${CSS.escape(noteEl.dataset.id!)}"]`);
        const want = ref ? ref.getBoundingClientRect().top - base - 2 : floor;
        const top = Math.max(want, floor);
        noteEl.style.top = `${top}px`;
        floor = top + noteEl.offsetHeight + 10;
      }
      side.style.minHeight = `${floor}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    if (body.current) ro.observe(body.current);
    window.addEventListener("resize", place);
    document.fonts?.ready.then(place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [notes]);

  return (
    <div className={`sidenoted ${notes.length ? "has-notes" : ""} ${className}`}>
      <CardHtml html={html} onReady={onReady} />
      {notes.length > 0 && (
        <aside className="sidenotes" ref={aside}>
          {notes.map((n) => (
            <div key={n.id} className="sidenote" data-id={n.id}>
              <span className="sidenote-mark">{n.label}</span>
              <CardHtml html={n.html} className="sidenote-body" />
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
