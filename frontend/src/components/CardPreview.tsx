import { useEffect, useState } from "react";
import { api } from "../api";
import { useDebounced } from "../lib/hooks";
import { CardHtml } from "./CardHtml";

type Previewed = { label: string; question: string; answer: string };

/** The cards a note will produce, rendered by Anki's template engine. */
export function CardPreview({ notetypeId, fields }: { notetypeId: number | null; fields: string[] }) {
  const debounced = useDebounced(fields, 200);
  const [cards, setCards] = useState<Previewed[]>([]);
  const [back, setBack] = useState<Record<number, boolean>>({});

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

  if (!cards.length) return <p className="muted">Nothing to preview yet.</p>;
  return (
    <div className="preview-stack">
      {cards.map((c, i) => (
        <button key={c.label + i} className="preview-card" onClick={() => setBack({ ...back, [i]: !back[i] })} title="Click to flip">
          <span className="preview-card-head">
            <span>{c.label}</span>
            <span>{back[i] ? "Back" : "Front"}</span>
          </span>
          <CardHtml html={back[i] ? c.answer : c.question} />
        </button>
      ))}
    </div>
  );
}
