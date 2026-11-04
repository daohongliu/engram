import { useMemo, useRef, useState } from "react";
import { Stats } from "../api";
import { plural } from "../lib/format";

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const show = (e: React.MouseEvent, text: string) => {
    const r = box.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  const el = tip && (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
  return { box, show, hide: () => setTip(null), el };
}

const CELL = 11;
const GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** One hue, light to dark. */
const RAMP = [
  "var(--sunken)",
  "color-mix(in srgb, var(--accent) 22%, var(--surface))",
  "color-mix(in srgb, var(--accent) 45%, var(--surface))",
  "color-mix(in srgb, var(--accent) 70%, var(--surface))",
  "var(--accent)",
];

export function Heatmap({ calendar }: { calendar: Stats["calendar"] }) {
  const tip = useTip();
  const { cells, weeks, months, thresholds } = useMemo(() => {
    const counts = calendar.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
    const q = (p: number) => counts[Math.floor(p * (counts.length - 1))] ?? 1;
    const thresholds = counts.length ? [1, q(0.4), q(0.7), q(0.9)] : [1, 2, 3, 4];
    const first = new Date(calendar[0]?.date ?? Date.now());
    const offset = (first.getDay() + 6) % 7;
    const cells = calendar.map((d, i) => {
      const idx = i + offset;
      const level = d.count ? Math.max(1, thresholds.filter((t) => d.count >= t).length) : 0;
      return { ...d, week: Math.floor(idx / 7), dow: idx % 7, level: Math.min(4, level) };
    });
    const months: { week: number; label: string }[] = [];
    let last = -1;
    for (const c of cells) {
      const m = new Date(c.date).getMonth();
      if (m !== last && c.dow === 0) {
        months.push({ week: c.week, label: MONTHS[m] });
        last = m;
      }
    }
    return { cells, weeks: Math.ceil((calendar.length + offset) / 7), months, thresholds };
  }, [calendar]);

  const L = 26;
  const width = L + weeks * (CELL + GAP);
  const height = 16 + 7 * (CELL + GAP);
  return (
    <div className="chart" ref={tip.box}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reviews per day over the past year">
        {months.map((m) => (
          <text key={m.week} x={L + m.week * (CELL + GAP)} y={10} className="chart-label">
            {m.label}
          </text>
        ))}
        {["Mon", "Wed", "Fri"].map((d, i) => (
          <text key={d} x={0} y={16 + i * 2 * (CELL + GAP) + 9} className="chart-label">
            {d}
          </text>
        ))}
        {cells.map((c) => (
          <rect
            key={c.date}
            x={L + c.week * (CELL + GAP)}
            y={16 + c.dow * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2}
            style={{ fill: RAMP[c.level] }}
            onMouseMove={(e) =>
              tip.show(e, `${new Date(c.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${c.count ? plural(c.count, "review") : "no reviews"}`)
            }
            onMouseLeave={tip.hide}
          />
        ))}
      </svg>
      <div className="chart-legend">
        <span>Less</span>
        {RAMP.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
        <span>More</span>
        <span>(top shade: {thresholds[3]}+ a day)</span>
      </div>
      {tip.el}
    </div>
  );
}

export function Forecast({ forecast }: { forecast: Stats["forecast"] }) {
  const tip = useTip();
  const max = Math.max(1, ...forecast.map((f) => f.count));
  if (forecast.every((f) => f.count === 0)) return <p className="muted">Nothing scheduled in the next month yet.</p>;
  const W = 600;
  const H = 120;
  const bw = W / forecast.length;
  const label = (d: number) => (d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`);
  return (
    <div className="chart" ref={tip.box}>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Cards due over the next month">
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={W} y1={H - f * (H - 8)} y2={H - f * (H - 8)} className="chart-grid" />
            <text x={W} y={H - f * (H - 8) - 3} textAnchor="end" className="chart-label">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <line x1={0} x2={W} y1={H} y2={H} className="chart-axis" />
        {forecast.map((f) => {
          const h = (f.count / max) * (H - 8);
          return (
            <g key={f.day} onMouseMove={(e) => tip.show(e, `${label(f.day)}: ${plural(f.count, "card")}`)} onMouseLeave={tip.hide}>
              <rect x={f.day * bw} y={0} width={bw} height={H} fill="transparent" />
              {f.count > 0 && <rect x={f.day * bw + 2} y={H - h} width={bw - 4} height={h} rx={2} style={{ fill: f.day === 0 ? "var(--learn)" : "var(--accent)" }} />}
            </g>
          );
        })}
        {[0, 7, 14, 21, 28].map((d) => (
          <text key={d} x={d * bw + bw / 2} y={H + 13} className="chart-label" textAnchor="middle">
            {d === 0 ? "Today" : `+${d}d`}
          </text>
        ))}
      </svg>
      {tip.el}
    </div>
  );
}

export function HourBars({ hours }: { hours: number[] }) {
  const tip = useTip();
  const max = Math.max(1, ...hours);
  const W = 600;
  const H = 80;
  const bw = W / 24;
  return (
    <div className="chart" ref={tip.box}>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Reviews by hour of day">
        <line x1={0} x2={W} y1={H} y2={H} className="chart-axis" />
        {hours.map((n, h) => {
          const height = (n / max) * (H - 6);
          return (
            <g key={h} onMouseMove={(e) => tip.show(e, `${h}:00–${h + 1}:00: ${plural(n, "review")}`)} onMouseLeave={tip.hide}>
              <rect x={h * bw} y={0} width={bw} height={H} fill="transparent" />
              {n > 0 && <rect x={h * bw + 2} y={H - height} width={bw - 4} height={height} rx={2} style={{ fill: "var(--accent)" }} />}
            </g>
          );
        })}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={h * bw + bw / 2} y={H + 13} className="chart-label" textAnchor="middle">
            {`${h}:00`}
          </text>
        ))}
      </svg>
      {tip.el}
    </div>
  );
}
