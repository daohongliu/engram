import { api } from "../api";
import { Forecast, Heatmap, HourBars } from "../components/Charts";
import { duration, plural } from "../lib/format";
import { useAsync } from "../lib/hooks";

const MAKEUP: { key: "new" | "learning" | "young" | "mature" | "suspended" | "buried"; label: string; colour: string; note: string }[] = [
  { key: "new", label: "New", colour: "color-mix(in srgb, var(--accent) 22%, var(--surface))", note: "Not studied yet" },
  { key: "learning", label: "Learning", colour: "color-mix(in srgb, var(--accent) 45%, var(--surface))", note: "In learning steps" },
  { key: "young", label: "Young", colour: "color-mix(in srgb, var(--accent) 70%, var(--surface))", note: "Interval under 21 days" },
  { key: "mature", label: "Mature", colour: "var(--accent)", note: "Interval 21 days or more" },
  { key: "suspended", label: "Suspended", colour: "var(--text-3)", note: "Excluded from review" },
  { key: "buried", label: "Buried", colour: "var(--border-strong)", note: "Hidden until tomorrow" },
];

export function Stats() {
  const { data } = useAsync(() => api.stats(), []);
  if (!data) return null;

  const total = data.calendar.reduce((a, d) => a + d.count, 0);
  const active = data.calendar.filter((d) => d.count > 0).length;
  const secs = data.calendar.reduce((a, d) => a + d.seconds, 0);
  const week = data.forecast.slice(0, 7).reduce((a, f) => a + f.count, 0);

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <p>
            {total ? `${plural(total, "review")} on ${plural(active, "day")} in the past year, ${duration(secs)} in total.` : "No reviews yet."}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="panel stat">
          <span className="label">Today</span>
          <strong>{data.today.cards}</strong>
          <small>{data.today.cards ? `${duration(data.today.seconds)}, ${data.today.again} again` : "cards studied"}</small>
        </div>
        <div className="panel stat">
          <span className="label">Streak</span>
          <strong>{data.streak}</strong>
          <small>{data.streak === 1 ? "day" : "days"}</small>
        </div>
        <div className="panel stat">
          <span className="label">Retention</span>
          <strong>{data.retention === null ? "—" : `${Math.round(data.retention * 100)}%`}</strong>
          <small>{data.retention === null ? "No reviews in 30 days" : `Last 30 days, ${plural(data.retentionSample, "review")}`}</small>
        </div>
        <div className="panel stat">
          <span className="label">Next 7 days</span>
          <strong>{week}</strong>
          <small>cards due</small>
        </div>
      </div>

      <section className="panel chart-panel">
        <header>
          <h2>Reviews</h2>
          <p>Past year</p>
        </header>
        <Heatmap calendar={data.calendar} />
      </section>

      <section className="panel chart-panel">
        <header>
          <h2>Forecast</h2>
          <p>Cards due each day; today includes overdue</p>
        </header>
        <Forecast forecast={data.forecast} />
      </section>

      <section className="panel chart-panel">
        <header>
          <h2>Card counts</h2>
          <p>{plural(data.totalCards, "card")}, {plural(data.totalNotes, "note")}</p>
        </header>
        <div className="makeup-bar" role="img" aria-label="Cards by state">
          {MAKEUP.filter((m) => data.counts[m.key] > 0).map((m) => (
            <span key={m.key} style={{ flexGrow: data.counts[m.key], background: m.colour }} title={`${m.label}: ${data.counts[m.key]}`} />
          ))}
        </div>
        <table className="makeup-table">
          <tbody>
            {MAKEUP.map((m) => (
              <tr key={m.key}>
                <td>
                  <span className="swatch" style={{ background: m.colour }} />
                  {m.label}
                </td>
                <td className="muted">{m.note}</td>
                <td className="num">{data.counts[m.key].toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel chart-panel">
        <header>
          <h2>Time of day</h2>
          <p>Reviews by hour, past 90 days · about {Math.round(data.secsPerCard)}s per card</p>
        </header>
        <HourBars hours={data.hours} />
      </section>
    </div>
  );
}
