import { decks as decksStore, flattenDecks } from "../lib/store";

export function DeckSelect({ value, onChange, id }: { value: number | null; onChange: (id: number) => void; id?: string }) {
  const data = decksStore.use();
  const flat = data ? flattenDecks(data.decks).filter((d) => !d.filtered) : [];
  return (
    <select id={id} className="select" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} aria-label="Deck">
      {value === null && (
        <option value="" disabled>
          Choose deck…
        </option>
      )}
      {flat.map((d) => (
        <option key={d.id} value={d.id}>
          {" ".repeat(d.depth) + d.name}
        </option>
      ))}
    </select>
  );
}
