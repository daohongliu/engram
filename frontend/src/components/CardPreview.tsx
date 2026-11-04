import { useEffect, useState } from "react";
import { api } from "../api";
import { useDebounced } from "../lib/hooks";
import { CardHtml } from "./CardHtml";

type Previewed = { label: string; question: string; answer: string };

/** The cards a note will produce, rendered by Anki's own template engine. */
export function CardPreview({ notetypeId, fields }: { notetypeId: number | null; fields: string[] }) {
  const debounced = useDebounced(fields, 220);
  const [cards, setCards] = useState<Previewed[]>([]);
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!notetypeId || !debounced.some((f) => f.trim())) {
      setCards([]);
      return;
    }
    let stale = false;
    api.preview(notetypeId, debounced).then(
      (r) => !stale && setCards(r.cards),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [notetypeId, debounced]);

  if (!cards.length) return <p className="margin-quiet">Cards appear here as you write.</p>;
  return (
    <div className="preview-stack">
      {cards.map((c, i) => (
        <button
          key={c.label + i}
          className={`index-card ${flipped[i] ? "is-flipped" : ""}`}
          onClick={() => setFlipped({ ...flipped, [i]: !flipped[i] })}
          title="Click to turn over"
        >
          <span className="index-card-label">
            {c.label} · {flipped[i] ? "back" : "front"}
          </span>
          <CardHtml html={flipped[i] ? c.answer : c.question} className="index-card-body" />
        </button>
      ))}
    </div>
  );
}
