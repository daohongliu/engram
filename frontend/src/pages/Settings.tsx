import { useEffect, useState } from "react";
import { api } from "../api";
import { renderTex, setPreamble } from "../lib/math";
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

  // Leaving without saving restores the saved macros.
  useEffect(() => () => void setPreamble(settingsStore.get()?.preamble ?? ""), []);

  const save = async () => {
    try {
      await api.saveSettings({ preamble });
      await settingsStore.refresh();
      toast.success("Preamble saved.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const dirty = s && preamble !== s.preamble;

  return (
    <div className="container">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <section className="panel settings-section">
        <h2>Appearance</h2>
        <p>Theme</p>
        <div className="segmented">
          {(["auto", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>
              {t === "auto" ? "System" : t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </section>

      <section className="panel settings-section">
        <h2>LaTeX macros</h2>
        <p>Definitions here apply to every card and to the editor preview. One <code>\newcommand</code> or <code>\def</code> per line.</p>
        <textarea className="preamble" value={preamble} onChange={(e) => setPre(e.target.value)} spellCheck={false} />
        {err && <p className="error-text">{err}</p>}
        <div className="preamble-try">
          <input className="input" value={sample} onChange={(e) => setSample(e.target.value)} spellCheck={false} aria-label="Test expression" />
        </div>
        <div className="preamble-out" dangerouslySetInnerHTML={{ __html: renderTex(sample, true) }} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || !!err}>
            Save
          </button>
        </div>
      </section>

      <section className="panel settings-section">
        <h2>Data</h2>
        <p>
          Collection: <code>{s?.collectionPath}</code>
        </p>
        <p>
          Images: <code>{s?.mediaPath}</code>
        </p>
        <p className="muted">Back up this folder to back up everything. The scheduler is {s?.fsrs ? "FSRS" : "SM-2"}.</p>
      </section>
    </div>
  );
}
