import { MOD, useKeys } from "../lib/keys";

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      [`${MOD} K`, "command palette"],
      ["/", "search cards"],
      ["n", "write a new card"],
      ["g c · g b · g w · g a", "contents, browse, write, almanac"],
      [`${MOD} Z`, "undo"],
      ["?", "this page"],
    ],
  },
  {
    title: "Studying",
    keys: [
      ["space", "show answer, then “good”"],
      ["1 2 3 4", "again, hard, good, easy"],
      ["e", "edit the card"],
      ["-", "bury until tomorrow"],
      ["!", "suspend"],
      ["u", "undo last answer"],
      ["esc", "back to contents"],
    ],
  },
  {
    title: "Browsing",
    keys: [
      ["j / k", "next, previous card"],
      ["x", "select card"],
      ["shift-click", "select a range"],
      ["enter", "edit the selected card"],
      ["esc", "back to the list"],
      ["s", "suspend or unsuspend"],
    ],
  },
  {
    title: "Writing",
    keys: [
      ["$", "inline maths (renders as you type)"],
      ["$$", "display maths"],
      [`${MOD} B · ${MOD} I`, "bold, italic"],
      [`${MOD} M`, "wrap in maths"],
      [`${MOD} ⇧ C`, "new cloze deletion"],
      [`${MOD} ⌥ ⇧ C`, "cloze with the same number"],
      [`${MOD} ↵`, "add the card"],
      ["paste or drop an image", "adds it to the card"],
      ["drag an image's corner", "resizes it"],
      ["![caption|300](…)", "an image 300px wide"],
    ],
  },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  useKeys((e) => {
    if (e.key === "Escape" || e.key === "?") {
      onClose();
      return true;
    }
  });
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="help-sheet" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Index of keys</h2>
        <div className="help-grid">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.keys.map(([k, v]) => (
                  <div key={k} className="help-row">
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="help-foot">
          There is also a hidden theme. It involves arrow keys and was not our idea originally.
        </p>
      </div>
    </div>
  );
}
