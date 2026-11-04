import { decks as decksStore, flattenDecks } from "../lib/store";

export function DeckSelect({
  value,
  onChange,
  label = "Deck",
  className = "",
}: {
  value: number | null;
  onChange: (id: number) => void;
  label?: string;
  className?: string;
}) {
  const data = decksStore.use();
  const flat = data ? flattenDecks(data.decks).filter((d) => !d.filtered) : [];
  return (
    <label className={`select-wrap ${className}`}>
      <span className="select-label">{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {value === null && <option value="">Choose…</option>}
        {flat.map((d) => (
          <option key={d.id} value={d.id}>
            {"  ".repeat(d.depth) + d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
