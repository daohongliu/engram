import { useMemo, useState } from "react";
import { CardDetail } from "../api";
import { days } from "../lib/format";

const RATING_COLOURS = ["var(--text-3)", "var(--again)", "var(--hard)", "var(--good)", "var(--easy)"];
const RATING_NAMES = ["Manual", "Again", "Hard", "Good", "Easy"];

function fmtInterval(secs: number) {
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return days(secs / 86400);
}

/** Scheduling facts and review history for one card. */
export function CardInfo({ card }: { card: CardDetail }) {
  const s = card.stats;
  const m = card.memory;
  const suspended = card.queue === -1;
  const date = (v?: string) => (v ? new Date(Number(v) * 1000).toLocaleDateString() : "—");
  return (
    <div>
      <dl className="facts">
        <Fact k="Due" v={suspended ? "Suspended" : card.due.label || "—"} />
        <Fact k="Interval" v={s.interval ? days(s.interval) : "—"} />
        <Fact k="Reviews" v={String(s.reviews ?? 0)} />
        <Fact k="Lapses" v={String(s.lapses ?? 0)} />
        <Fact k="Stability" v={m ? days(m.stability) : "—"} />
        <Fact k="Difficulty" v={m?.difficulty != null ? `${Math.round(m.difficulty * 100)}%` : "—"} />
        <Fact k="Recall now" v={m?.retrievability != null ? `${Math.round(m.retrievability * 100)}%` : "—"} />
        <Fact k="Added" v={date(s.added)} />
        <Fact k="First review" v={date(s.firstReview)} />
        <Fact k="Latest review" v={date(s.latestReview)} />
      </dl>
      <History card={card} />
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function History({ card }: { card: CardDetail }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const entries = (card.stats.revlog ?? [])
      .filter((r) => r.time)
      .map((r) => ({ ...r, t: Number(r.time) }))
      .sort((a, b) => a.t - b.t);
    if (!entries.length) return [];
    const t0 = entries[0].t;
    const t1 = Math.max(entries[entries.length - 1].t, t0 + 1);
    return entries.map((e) => ({ ...e, x: 8 + ((e.t - t0) / (t1 - t0)) * 264 }));
  }, [card]);

  if (!points.length) return <p className="muted" style={{ marginTop: 12 }}>No reviews yet.</p>;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="history" style={{ marginTop: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>
        Review history
      </div>
      <svg viewBox="0 0 280 20" role="img" aria-label={`${points.length} reviews`}>
        <line x1={0} x2={280} y1={10} y2={10} className="chart-grid" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={p.x} cy={10} r={9} fill="transparent" />
            <circle cx={p.x} cy={10} r={hover === i ? 5.5 : 4.5} style={{ fill: RATING_COLOURS[p.buttonChosen ?? 0], stroke: "var(--surface)", strokeWidth: 1.5 }} />
          </g>
        ))}
      </svg>
      <div className="history-legend">
        {h ? (
          <span style={{ ["--c" as string]: RATING_COLOURS[h.buttonChosen ?? 0] }}>
            {new Date(h.t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {RATING_NAMES[h.buttonChosen ?? 0]}
            {h.interval ? ` · next in ${fmtInterval(h.interval)}` : ""}
          </span>
        ) : (
          [1, 2, 3, 4].map((b) => (
            <span key={b} style={{ ["--c" as string]: RATING_COLOURS[b] }}>
              {RATING_NAMES[b]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
