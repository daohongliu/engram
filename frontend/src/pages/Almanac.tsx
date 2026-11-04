import { api } from "../api";
import { Forecast, Heatmap, StudyClock } from "../components/Charts";
import { Scribble } from "../components/Sketch";
import { duration, plural } from "../lib/format";
import { useAsync } from "../lib/hooks";

const MAKEUP: { key: "new" | "learning" | "young" | "mature" | "suspended" | "buried"; label: string; note: string }[] = [
  { key: "new", label: "new", note: "not yet studied" },
  { key: "learning", label: "learning", note: "in their first steps" },
  { key: "young", label: "young", note: "interval under three weeks" },
  { key: "mature", label: "mature", note: "interval three weeks or more" },
  { key: "suspended", label: "suspended", note: "set aside" },
  { key: "buried", label: "buried", note: "back tomorrow" },
];

/* Ordered states, so a single-hue ramp (light to dark) rather than a palette. */
const RAMP: Record<string, string> = {
  new: "color-mix(in oklab, var(--green) 22%, var(--paper))",
  learning: "color-mix(in oklab, var(--green) 45%, var(--paper))",
  young: "color-mix(in oklab, var(--green) 70%, var(--paper))",
  mature: "var(--green)",
  suspended: "var(--ink-4)",
  buried: "var(--rule-strong)",
};

export function Almanac() {
  const { data } = useAsync(() => api.stats(), []);
  if (!data) return <div className="three-col"><article className="main-col"><p className="margin-quiet">Counting…</p></article></div>;

  const busiestHour = data.hours.indexOf(Math.max(...data.hours));
  const totalReviews = data.calendar.reduce((a, d) => a + d.count, 0);
  const activeDays = data.calendar.filter((d) => d.count > 0).length;
  const totalSecs = data.calendar.reduce((a, d) => a + d.seconds, 0);
  const tomorrow = data.forecast[1]?.count ?? 0;
  const week = data.forecast.slice(0, 7).reduce((a, f) => a + f.count, 0);
  const chronotype =
    data.hours.every((h) => h === 0)
      ? null
      : busiestHour < 5
        ? "a night owl, by the look of it"
        : busiestHour < 11
          ? "a morning person"
          : busiestHour < 17
            ? "an afternoon studier"
            : busiestHour < 21
              ? "an evening reader"
              : "a late-night crammer, and we say that kindly";

  return (
    <div className="three-col almanac">
      <aside className="margin margin-left">
        <div className="today-box">
          <div className="smallcaps">Streak</div>
          <div className="today-number">{data.streak}</div>
          <div className="today-caption">{data.streak === 1 ? "day" : "days"} in a row</div>
        </div>
      </aside>
      <article className="main-col">
        <header className="page-header">
          <p className="kicker">Being an account of the year so far</p>
          <h1>
            Almanac
            <Scribble seed={14} width={170} />
          </h1>
          <p className="dek">
            {totalReviews
              ? `${plural(totalReviews, "review")} over ${plural(activeDays, "day")}, about ${duration(totalSecs)} in all. Today: ${plural(data.today.cards, "card")}${data.today.again ? `, ${data.today.again} of them forgotten` : ""}.`
              : "No reviews yet. Every almanac starts with a blank page."}
          </p>
        </header>

        <section className="almanac-section">
          <h2>The year</h2>
          <figure className="figure">
            <Heatmap calendar={data.calendar} />
            <figcaption>
              <strong>Fig. 1.</strong> Reviews per day. Hover a square for the count.
            </figcaption>
          </figure>
        </section>

        <section className="almanac-section">
          <h2>The month ahead</h2>
          <p>
            {plural(tomorrow, "card")} tomorrow and {plural(week, "card")} over the next seven days, assuming you keep up
            and add nothing new (you will add something new).
          </p>
          <figure className="figure">
            <Forecast forecast={data.forecast} />
            <figcaption>
              <strong>Fig. 2.</strong> Cards falling due each day. Today’s bar includes anything overdue.
            </figcaption>
          </figure>
        </section>

        <section className="almanac-section">
          <h2>What the collection is made of</h2>
          <div className="makeup-bar" role="img" aria-label="Collection by state">
            {MAKEUP.filter((m) => data.counts[m.key] > 0).map((m) => (
              <span
                key={m.key}
                style={{ flexGrow: data.counts[m.key], background: RAMP[m.key] }}
                className={`makeup-seg seg-${m.key}`}
                title={`${m.label}: ${data.counts[m.key]}`}
              />
            ))}
          </div>
          <table className="makeup-table">
            <tbody>
              {MAKEUP.map((m) => (
                <tr key={m.key}>
                  <td>
                    <span className={`swatch seg-${m.key}`} style={{ background: RAMP[m.key] }} />
                    {m.label}
                  </td>
                  <td className="num">{data.counts[m.key].toLocaleString()}</td>
                  <td className="margin-quiet">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="almanac-section almanac-two">
          <div>
            <h2>When you study</h2>
            <p>{chronotype ? `Mostly around ${busiestHour}:00. You are ${chronotype}.` : "Not enough reviews to tell yet."}</p>
          </div>
          <StudyClock hours={data.hours} />
        </section>
      </article>
      <aside className="margin margin-right">
        <div className="sidenote sidenote-static">
          <span className="smallcaps">True retention</span>
          <p className="big-figure">{data.retention === null ? "—" : `${Math.round(data.retention * 100)}%`}</p>
          <p>
            {data.retention === null
              ? "Shown once you have reviewed some mature cards this month."
              : `Of ${plural(data.retentionSample, "review")} of graduated cards in the last 30 days, this share were remembered. FSRS aims for whatever you set in a deck’s limits, 90% by default.`}
          </p>
        </div>
        <div className="sidenote sidenote-static">
          <span className="smallcaps">Pace</span>
          <p>About {Math.round(data.secsPerCard)} seconds a card, recently.</p>
        </div>
      </aside>
    </div>
  );
}
