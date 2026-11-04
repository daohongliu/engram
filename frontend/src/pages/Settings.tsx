import { useEffect, useState } from "react";
import { api } from "../api";
import { getPreambleError, renderTex, setPreamble } from "../lib/math";
import { settings as settingsStore } from "../lib/store";
import { setTheme, Theme, useTheme } from "../lib/theme";
import { toast } from "../lib/toast";

const SAMPLE = String.raw`f: \R \to \R,\quad \norm{x}_2,\quad \abs{a-b} < \eps`;

export function SettingsPage() {
  const s = settingsStore.use();
  const theme = useTheme();
  const [preamble, setPre] = useState(s?.preamble ?? "");
  const [sample, setSample] = useState(SAMPLE);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (s) setPre(s.preamble);
  }, [s]);

  useEffect(() => {
    setErr(setPreamble(preamble));
  }, [preamble]);

  // Restore the saved preamble if we leave without saving.
  useEffect(() => () => void (s && setPreamble(settingsStore.get()?.preamble ?? s.preamble)), [s]);

  const save = async () => {
    try {
      await api.saveSettings({ preamble });
      await settingsStore.refresh();
      toast.success("Preamble saved.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="three-col settings-page">
      <aside className="margin margin-left" />
      <article className="main-col">
        <header className="page-header">
          <p className="kicker">Small print</p>
          <h1>Settings</h1>
        </header>

        <section className="settings-section">
          <h2>LaTeX preamble</h2>
          <p>
            Macros defined here work in every card and in the editor’s live preview. Use <code>\newcommand</code> or{" "}
            <code>\def</code>, one per line.
          </p>
          <textarea className="preamble" value={preamble} onChange={(e) => setPre(e.target.value)} spellCheck={false} rows={12} />
          {err && <p className="query-error">Hmm. {err}</p>}
          <div className="preamble-try">
            <label>
              Try it:
              <input value={sample} onChange={(e) => setSample(e.target.value)} spellCheck={false} />
            </label>
            <div className="preamble-out" dangerouslySetInnerHTML={{ __html: renderTex(sample, true) }} />
          </div>
          <button className="button button-primary" onClick={() => void save()} disabled={!!getPreambleError()}>
            Save preamble
          </button>
        </section>

        <section className="settings-section">
          <h2>Appearance</h2>
          <div className="segmented">
            {(["auto", "light", "dark"] as Theme[]).map((t) => (
              <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>
                {t === "auto" ? "Follow the system" : t === "light" ? "Paper" : "Lamplight"}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h2>Collection</h2>
          <p>
            Your cards live in <code>{s?.collectionPath}</code>, and pictures in{" "}
            <code>{s?.mediaPath}</code>. Back up that folder and you have backed up everything. Start the
            server with <code>--collection some/other/collection.anki2</code> to keep a separate collection.
          </p>
          <p>
            Scheduler: {s?.fsrs ? "FSRS, the modern memory model Anki ships with." : "the classic SM-2 algorithm."}
          </p>
        </section>
      </article>
      <aside className="margin margin-right" />
    </div>
  );
}
