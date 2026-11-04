import { useEffect, useMemo, useRef, useState } from "react";
import { api, Notetype } from "../api";
import { CardPreview } from "../components/CardPreview";
import { DeckSelect } from "../components/DeckSelect";
import { FieldValue, NoteFields } from "../components/NoteFields";
import { focusFirstEditor } from "../editor/MarkdownField";
import { useLocalStorage } from "../lib/hooks";
import { MOD } from "../lib/keys";
import { inlineMarkdown } from "../lib/md";
import { useLocation } from "../lib/router";
import { decks as decksStore, flattenDecks, invalidate, notetypes as notetypesStore } from "../lib/store";
import { toast } from "../lib/toast";
import { undoLast } from "../lib/undo";

const SHORT_NAMES: Record<string, string> = {
  Basic: "Question & answer",
  "Basic (and reversed card)": "Both ways",
  Cloze: "Cloze",
  "Basic (type in the answer)": "Type the answer",
};

interface Written {
  noteId: number;
  summary: string;
  deck: string;
}

export function Write() {
  const { params } = useLocation();
  const types = notetypesStore.use();
  const deckData = decksStore.use();
  const [lastType, setLastType] = useLocalStorage<number | null>("write.notetype", null);
  const [lastDeck, setLastDeck] = useLocalStorage<number | null>("write.deck", null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [deckId, setDeckId] = useState<number | null>(params.get("deck") ? Number(params.get("deck")) : lastDeck);
  const [fields, setFields] = useState<FieldValue[]>([]);
  const [tags, setTags] = useLocalStorage<string[]>("write.tags", []);
  const [written, setWritten] = useState<Written[]>([]);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const form = useRef<HTMLDivElement>(null);

  const notetype: Notetype | undefined = types?.find((t) => t.id === typeId);

  useEffect(() => {
    if (!types?.length || typeId !== null) return;
    setTypeId(types.find((t) => t.id === lastType)?.id ?? types[0].id);
  }, [types, typeId, lastType]);

  useEffect(() => {
    if (deckId !== null || !deckData) return;
    const first = flattenDecks(deckData.decks).find((d) => !d.filtered && d.id !== 1) ?? flattenDecks(deckData.decks)[0];
    if (first) setDeckId(first.id);
  }, [deckData, deckId]);

  const deckParam = params.get("deck");
  useEffect(() => {
    if (deckParam) setDeckId(Number(deckParam));
  }, [deckParam]);

  // Keep what has been typed when switching note type, matched by position.
  useEffect(() => {
    if (!notetype) return;
    setFields((old) => notetype.fields.map((name, i) => ({ name, value: old.find((f) => f.name === name)?.value ?? old[i]?.value ?? "" })));
  }, [notetype]);

  const deckName = useMemo(
    () => flattenDecks(deckData?.decks ?? []).find((d) => d.id === deckId)?.fullName ?? "",
    [deckData, deckId],
  );

  const submit = async () => {
    if (!notetype || deckId === null || busy) return;
    if (!fields[0]?.value.trim()) {
      toast.error(`The ${fields[0]?.name ?? "first"} field is empty.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.addNote({ notetypeId: notetype.id, deckId, fields: fields.map((f) => f.value), tags });
      setWritten((w) => [{ noteId: r.noteId, summary: inlineMarkdown(fields[0].value), deck: deckName }, ...w].slice(0, 12));
      toast.success(
        r.warning ? `Added, but note: ${r.warning.charAt(0).toLowerCase()}${r.warning.slice(1)}` : `Added ${r.cardIds.length === 1 ? "a card" : `${r.cardIds.length} cards`} to ${deckName.split("::").slice(-1)[0]}.`,
        { label: "Undo", run: () => void undoLast() },
      );
      setFields(fields.map((f) => ({ ...f, value: "" })));
      setLastType(notetype.id);
      setLastDeck(deckId);
      setRound((n) => n + 1);
      invalidate();
      requestAnimationFrame(() => focusFirstEditor(form.current));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const primary = types?.filter((t) => SHORT_NAMES[t.name]) ?? [];
  const others = types?.filter((t) => !SHORT_NAMES[t.name] && t.name !== "Image Occlusion") ?? [];

  return (
    <div className="three-col write-page">
      <aside className="margin margin-left">
        <div className="sidenote sidenote-static">
          <h3 className="smallcaps">On writing cards</h3>
          <p>One idea per card. If the answer has a list in it, it probably wants to be several clozes.</p>
          <p>Write the question you would actually be asked, not the textbook heading.</p>
          <p>Asides go in footnotes[^1], so they show up in the margin without getting in the way.</p>
        </div>
        <div className="sidenote sidenote-static cheatsheet">
          <h3 className="smallcaps">Syntax</h3>
          <dl>
            <dt>$x^2$</dt>
            <dd>inline maths</dd>
            <dt>$$…$$</dt>
            <dd>display maths</dd>
            <dt>**bold** *it*</dt>
            <dd>emphasis</dd>
            <dt>{"{{c1::…}}"}</dt>
            <dd>
              cloze, <kbd>{MOD}⇧C</kbd>
            </dd>
            <dt>[^1]</dt>
            <dd>margin note</dd>
          </dl>
        </div>
      </aside>

      <article className="main-col">
        <header className="page-header">
          <p className="kicker">A fresh index card</p>
          <h1>Write</h1>
        </header>

        <div className="write-controls">
          <div className="segmented" role="radiogroup" aria-label="Kind of card">
            {primary.map((t) => (
              <button key={t.id} role="radio" aria-checked={t.id === typeId} className={t.id === typeId ? "on" : ""} onClick={() => setTypeId(t.id)}>
                {SHORT_NAMES[t.name]}
              </button>
            ))}
          </div>
          <DeckSelect value={deckId} onChange={setDeckId} label="into" />
          {others.length > 0 && (
            <label className="select-wrap other-types">
              <span className="select-label">or another type:</span>
              <select value={others.some((t) => t.id === typeId) ? typeId! : ""} onChange={(e) => setTypeId(Number(e.target.value))}>
                <option value="" disabled>
                  choose…
                </option>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="write-sheet" ref={form}>
          {notetype && (
            <NoteFields
              key={`${notetype.id}-${round}`}
              idPrefix={`w${round}`}
              fields={fields}
              onField={(i, v) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, value: v } : f)))}
              tags={tags}
              onTags={setTags}
              onSubmit={() => void submit()}
              autoFocus
            />
          )}
          <div className="write-actions">
            <span className="margin-quiet">
              <kbd>{MOD} ↵</kbd> adds the card. Deck, type and tags stay put for the next one.
            </span>
            <button className="button button-primary" onClick={() => void submit()} disabled={busy}>
              Add card
            </button>
          </div>
        </div>
      </article>

      <aside className="margin margin-right">
        <h3 className="smallcaps">Preview</h3>
        <CardPreview notetypeId={typeId} fields={fields.map((f) => f.value)} />
        {written.length > 0 && (
          <div className="written">
            <h3 className="smallcaps">Written just now</h3>
            <ol>
              {written.map((w) => (
                <li key={w.noteId}>
                  <a href={`/browse?q=${encodeURIComponent(`nid:${w.noteId}`)}`} dangerouslySetInnerHTML={{ __html: w.summary }} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}
