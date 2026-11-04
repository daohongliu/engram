import { useMemo, useRef, useState } from "react";
import { Stats } from "../api";
import { plural } from "../lib/format";
import { RoughRect } from "./Sketch";

/* ------------------------------------------------------------------ */
/* Shared tooltip                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Calendar heatmap                                                    */
/* ------------------------------------------------------------------ */

const CELL = 11;
const GAP = 2;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sequential, one hue: more reviews, denser hatching, darker ink. */
const LEVELS = [
  { color: "var(--rule)", options: {} },
  { color: "var(--accent)", fill: "var(--accent)", options: { fillStyle: "hachure", hachureGap: 4.2, fillWeight: 0.7, hachureAngle: -45 } },
  { color: "var(--accent)", fill: "var(--accent)", options: { fillStyle: "hachure", hachureGap: 2.6, fillWeight: 0.9, hachureAngle: -45 } },
  { color: "var(--accent)", fill: "var(--accent)", options: { fillStyle: "cross-hatch", hachureGap: 2.6, fillWeight: 0.9, hachureAngle: -45 } },
  { color: "var(--accent-ink)", fill: "var(--accent)", options: { fillStyle: "solid" } },
];

export function Heatmap({ calendar }: { calendar: Stats["calendar"] }) {
  const tip = useTip();
  const { cells, weeks, monthLabels, thresholds } = useMemo(() => {
    const counts = calendar.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
    const q = (p: number) => counts[Math.floor(p * (counts.length - 1))] ?? 1;
    const thresholds = counts.length ? [1, q(0.4), q(0.7), q(0.9)] : [1, 2, 3, 4];
    const first = new Date(calendar[0]?.date ?? Date.now());
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const cells = calendar.map((d, i) => {
      const idx = i + offset;
      const level = d.count === 0 ? 0 : thresholds.filter((t) => d.count >= t).length;
      return { ...d, week: Math.floor(idx / 7), dow: idx % 7, level: Math.min(4, Math.max(level, d.count ? 1 : 0)) };
    });
    const weeks = Math.ceil((calendar.length + offset) / 7);
    const monthLabels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (const c of cells) {
      const m = new Date(c.date).getMonth();
      if (m !== lastMonth && c.dow === 0) {
        monthLabels.push({ week: c.week, label: MONTHS[m] });
        lastMonth = m;
      }
    }
    return { cells, weeks, monthLabels, thresholds };
  }, [calendar]);

  const width = 24 + weeks * (CELL + GAP);
  const height = 16 + 7 * (CELL + GAP);
  return (
    <div className="chart" ref={tip.box}>
      <svg viewBox={`0 0 ${width} ${height}`} className="heatmap" role="img" aria-label="Reviews per day over the last year">
        {monthLabels.map((m) => (
          <text key={m.week} x={24 + m.week * (CELL + GAP)} y={10} className="chart-label">
            {m.label}
          </text>
        ))}
        {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) =>
          d ? (
            <text key={d} x={0} y={16 + i * (CELL + GAP) + 9} className="chart-label">
              {d}
            </text>
          ) : null,
        )}
        {cells.map((c) => {
          const L = LEVELS[c.level];
          const x = 24 + c.week * (CELL + GAP);
          const y = 16 + c.dow * (CELL + GAP);
          return (
            <g
              key={c.date}
              onMouseMove={(e) => tip.show(e, `${new Date(c.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${c.count ? plural(c.count, "review") : "no reviews"}`)}
              onMouseLeave={tip.hide}
            >
              <rect x={x - 1} y={y - 1} width={CELL + 2} height={CELL + 2} fill="transparent" />
              <RoughRect x={x} y={y} w={CELL} h={CELL} seed={c.week * 7 + c.dow + 1} color={L.color} fill={L.fill} options={{ roughness: 0.6, strokeWidth: 0.8, ...L.options }} />
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span>fewer</span>
        {LEVELS.map((L, i) => (
          <svg key={i} width={CELL + 2} height={CELL + 2} aria-hidden>
            <RoughRect x={1} y={1} w={CELL} h={CELL} seed={900 + i} color={L.color} fill={L.fill} options={{ roughness: 0.6, strokeWidth: 0.8, ...L.options }} />
          </svg>
        ))}
        <span>more</span>
        <span className="chart-legend-note">
          (darkest ≥ {thresholds[3]} a day)
        </span>
      </div>
      {tip.el}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forecast bars                                                       */
/* ------------------------------------------------------------------ */

export function Forecast({ forecast }: { forecast: Stats["forecast"] }) {
  const tip = useTip();
  const max = Math.max(1, ...forecast.map((f) => f.count));
  if (forecast.every((f) => f.count === 0)) {
    return <p className="margin-quiet">Nothing scheduled yet. Study some new cards and the month will fill in.</p>;
  }
  const W = 600;
  const H = 140;
  const bw = W / forecast.length;
  const label = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
  return (
    <div className="chart" ref={tip.box}>
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="forecast" role="img" aria-label="Cards due over the next month">
        <line x1={0} x2={W} y1={H} y2={H} className="chart-axis" />
        {forecast.map((f) => {
          const h = (f.count / max) * (H - 10);
          return (
            <g key={f.day} onMouseMove={(e) => tip.show(e, `${label(f.day)}: ${plural(f.count, "card")}`)} onMouseLeave={tip.hide}>
              <rect x={f.day * bw} y={0} width={bw} height={H} fill="transparent" />
              {f.count > 0 && (
                <RoughRect
                  x={f.day * bw + 2}
                  y={H - h}
                  w={bw - 4}
                  h={h}
                  seed={f.day + 40}
                  color={f.day === 0 ? "var(--accent)" : "var(--blue)"}
                  fill={f.day === 0 ? "var(--accent)" : "var(--blue)"}
                  options={{ fillStyle: "hachure", hachureGap: 3, fillWeight: 0.8, roughness: 0.7, hachureAngle: -45 }}
                />
              )}
            </g>
          );
        })}
        {[0, 7, 14, 21, 28].map((d) => (
          <text key={d} x={d * bw + bw / 2} y={H + 15} className="chart-label" textAnchor="middle">
            {d === 0 ? "today" : `+${d}d`}
          </text>
        ))}
        <text x={W} y={10} className="chart-label" textAnchor="end">
          {max} max
        </text>
      </svg>
      {tip.el}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hour-of-day clock                                                   */
/* ------------------------------------------------------------------ */

export function StudyClock({ hours }: { hours: number[] }) {
  const tip = useTip();
  const max = Math.max(1, ...hours);
  const R = 70;
  const C = 90;
  const wedge = (h: number, r: number) => {
    const a0 = ((h / 24) * 360 - 90 - 6.5) * (Math.PI / 180);
    const a1 = ((h / 24) * 360 - 90 + 6.5) * (Math.PI / 180);
    const p = (a: number, rr: number) => `${C + rr * Math.cos(a)} ${C + rr * Math.sin(a)}`;
    return `M ${p(a0, 14)} L ${p(a0, r)} A ${r} ${r} 0 0 1 ${p(a1, r)} L ${p(a1, 14)} Z`;
  };
  return (
    <div className="chart chart-clock" ref={tip.box}>
      <svg viewBox="0 0 180 180" role="img" aria-label="Reviews by hour of day">
        <circle cx={C} cy={C} r={R + 4} className="clock-face" />
        {hours.map((n, h) =>
          n > 0 ? (
            <path
              key={h}
              d={wedge(h, 14 + (n / max) * (R - 14))}
              className="clock-wedge"
              style={{ opacity: 0.35 + 0.65 * (n / max) }}
              onMouseMove={(e) => tip.show(e, `${h}:00–${h + 1}:00 · ${plural(n, "review")}`)}
              onMouseLeave={tip.hide}
            />
          ) : null,
        )}
        {[0, 6, 12, 18].map((h) => {
          const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
          return (
            <text key={h} x={C + (R + 12) * Math.cos(a)} y={C + (R + 12) * Math.sin(a) + 3} textAnchor="middle" className="chart-label">
              {h === 0 ? "midnight" : h === 12 ? "noon" : `${h}h`}
            </text>
          );
        })}
      </svg>
      {tip.el}
    </div>
  );
}
