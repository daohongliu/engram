import { MOD, useKeys } from "../lib/keys";

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "General",
    keys: [
      [`${MOD} K`, "Go to…"],
      ["D A B T", "Decks, Add, Browse, Stats"],
      ["/", "Search cards"],
      [`${MOD} Z`, "Undo"],
      ["?", "Keyboard shortcuts"],
    ],
  },
  {
    title: "Reviewing",
    keys: [
      ["Space", "Show answer, then Good"],
      ["1 2 3 4", "Again, Hard, Good, Easy"],
      ["E", "Edit card"],
      ["I", "Card info"],
      ["-", "Bury"],
      ["!", "Suspend"],
      ["U", "Undo"],
      ["Esc", "Back to deck"],
    ],
  },
  {
    title: "Browsing",
    keys: [
      ["↑ ↓ or J K", "Previous / next card"],
      ["Shift-click", "Select a range"],
      [`${MOD}-click`, "Add to selection"],
      [`${MOD} A`, "Select all"],
      ["Enter", "Edit selected card"],
      ["Esc", "Clear selection"],
    ],
  },
  {
    title: "Editing",
    keys: [
      ["$ … $", "Inline maths"],
      ["$$ … $$", "Display maths"],
      [`${MOD} B / ${MOD} I`, "Bold / italic"],
      [`${MOD} M`, "Wrap in maths"],
      [`${MOD} ⇧ C`, "New cloze"],
      [`${MOD} ⌥ ⇧ C`, "Cloze, same number"],
      ["Paste / drop", "Add an image"],
      [`${MOD} Enter`, "Add card"],
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
        <h2>Keyboard shortcuts</h2>
        <div className="help-grid">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.keys.map(([k, v]) => (
                  <div key={k} className="help-row">
                    <dd>{v}</dd>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
