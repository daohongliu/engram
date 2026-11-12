import { api } from "../api";
import { notetypes } from "../lib/store";

/** Pick a note type for an existing note. */
export function NotetypeSelect({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const types = notetypes.use();
  return (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Note type">
      {(types ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
      {!types?.some((t) => t.id === value) && <option value={value}>…</option>}
    </select>
  );
}

/** Change a note's type and say what happened to its cards. */
export async function changeNotetype(noteId: number, notetypeId: number) {
  const res = await api.changeNotetype(noteId, notetypeId);
  const parts = [`Changed to ${res.notetype.name}.`];
  if (res.addedCardIds.length) parts.push(`${res.addedCardIds.length} card${res.addedCardIds.length > 1 ? "s" : ""} added.`);
  if (res.removedCardIds.length) parts.push(`${res.removedCardIds.length} card${res.removedCardIds.length > 1 ? "s" : ""} removed.`);
  return { ...res, message: parts.join(" ") };
}
