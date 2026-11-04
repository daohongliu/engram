from __future__ import annotations

import re
from typing import Any

from anki.errors import NotFoundError
from anki.notes import Note, NoteFieldsCheckResult
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..cardinfo import clean_card_html, split_answer
from ..fields import decode_field, encode_field
from ..store import collection, drop_unused_tags

router = APIRouter(prefix="/api", tags=["notes"])

_CLOZE_RE = re.compile(r"\{\{c(\d+)::")

# Notetypes people actually write new notes with, in the order we offer them.
PREFERRED = ["Basic", "Basic (and reversed card)", "Cloze", "Basic (type in the answer)"]


@router.get("/notetypes")
def notetypes() -> list[dict[str, Any]]:
    with collection() as col:
        out = []
        for m in col.models.all():
            out.append(
                {
                    "id": m["id"],
                    "name": m["name"],
                    "fields": [f["name"] for f in m["flds"]],
                    "templates": [t["name"] for t in m["tmpls"]],
                    "isCloze": m["type"] == 1,
                    "useCount": col.models.use_count(m),
                }
            )
        out.sort(
            key=lambda m: (
                PREFERRED.index(m["name"]) if m["name"] in PREFERRED else len(PREFERRED),
                -m["useCount"],
                m["name"].lower(),
            )
        )
        return out


class NoteIn(BaseModel):
    notetypeId: int | None = None
    deckId: int | None = None
    fields: list[str]
    tags: list[str] = []


def _fill(note: Note, sources: list[str]) -> None:
    names = [f["name"] for f in note.note_type()["flds"]]
    for i, name in enumerate(names):
        src = sources[i] if i < len(sources) else ""
        note.fields[i] = encode_field(src, doc_id=re.sub(r"\W+", "", name.lower()) or f"f{i}")


_CHECK_MESSAGES = {
    NoteFieldsCheckResult.EMPTY: "The first field is empty.",
    NoteFieldsCheckResult.DUPLICATE: "A note with this first field already exists.",
    NoteFieldsCheckResult.MISSING_CLOZE: "Cloze notes need at least one {{c1::deletion}}.",
    NoteFieldsCheckResult.NOTETYPE_NOT_CLOZE: "Cloze deletions only work with a Cloze note type.",
    NoteFieldsCheckResult.FIELD_NOT_CLOZE: "This field does not support cloze deletions.",
}


@router.post("/notes")
def add_note(body: NoteIn) -> dict[str, Any]:
    if body.notetypeId is None or body.deckId is None:
        raise HTTPException(400, "Choose a note type and a deck.")
    with collection() as col:
        nt = col.models.get(body.notetypeId)
        if not nt:
            raise HTTPException(404, "No such note type.")
        note = col.new_note(nt)
        _fill(note, body.fields)
        note.tags = [t for t in body.tags if t.strip()]
        check = note.fields_check()
        if check in (
            NoteFieldsCheckResult.EMPTY,
            NoteFieldsCheckResult.MISSING_CLOZE,
            NoteFieldsCheckResult.NOTETYPE_NOT_CLOZE,
        ):
            raise HTTPException(400, _CHECK_MESSAGES[check])
        try:
            col.add_note(note, body.deckId)
        except Exception as exc:
            raise HTTPException(400, str(exc))
        return {
            "noteId": note.id,
            "cardIds": list(note.card_ids()),
            "warning": _CHECK_MESSAGES.get(check) if check != NoteFieldsCheckResult.NORMAL else None,
        }


@router.get("/notes/{note_id}")
def get_note(note_id: int) -> dict[str, Any]:
    with collection() as col:
        try:
            note = col.get_note(note_id)
        except NotFoundError:
            raise HTTPException(404, "No such note.")
        nt = note.note_type()
        return {
            "id": note.id,
            "notetype": {"id": nt["id"], "name": nt["name"], "isCloze": nt["type"] == 1},
            "fields": [
                {"name": f["name"], **decode_field(note.fields[i]).__dict__}
                for i, f in enumerate(nt["flds"])
            ],
            "tags": note.tags,
            "cardIds": list(note.card_ids()),
        }


@router.put("/notes/{note_id}")
def update_note(note_id: int, body: NoteIn) -> dict[str, Any]:
    with collection() as col:
        try:
            note = col.get_note(note_id)
        except NotFoundError:
            raise HTTPException(404, "No such note.")
        before = list(note.fields), list(note.tags)
        current = [decode_field(f) for f in note.fields]
        # Only re-encode fields whose Markdown actually changed, so that
        # opening an imported note never rewrites its HTML behind your back.
        names = [f["name"] for f in note.note_type()["flds"]]
        for i, name in enumerate(names):
            if i < len(body.fields) and body.fields[i] != current[i].source:
                note.fields[i] = encode_field(
                    body.fields[i], doc_id=re.sub(r"\W+", "", name.lower()) or f"f{i}"
                )
        note.tags = [t for t in body.tags if t.strip()]
        if (list(note.fields), list(note.tags)) != before:
            col.update_note(note)
            if list(note.tags) != before[1]:
                drop_unused_tags(col)
        if body.deckId is not None:
            col.set_deck(list(note.card_ids()), body.deckId)
        return {"ok": True, "noteId": note.id, "changed": (list(note.fields), list(note.tags)) != before}


@router.delete("/notes/{note_id}")
def delete_note(note_id: int) -> dict[str, Any]:
    with collection() as col:
        col.remove_notes([note_id])
        drop_unused_tags(col)
        return {"ok": True}


class PreviewIn(BaseModel):
    notetypeId: int
    fields: list[str]


@router.post("/notes/preview")
def preview(body: PreviewIn) -> dict[str, Any]:
    """Render the cards a note would produce, without saving anything."""
    with collection() as col:
        nt = col.models.get(body.notetypeId)
        if not nt:
            raise HTTPException(404, "No such note type.")
        note = col.new_note(nt)
        _fill(note, body.fields)
        if nt["type"] == 1:
            nums = sorted({int(n) for f in body.fields for n in _CLOZE_RE.findall(f)}) or [1]
            ords = [n - 1 for n in nums]
            labels = [f"Cloze {n}" for n in nums]
        else:
            ords = list(range(len(nt["tmpls"])))
            labels = [t["name"] for t in nt["tmpls"]]
        cards = []
        for ord_, label in zip(ords, labels):
            try:
                card = note.ephemeral_card(ord_)
                q = clean_card_html(card.question(), card.question_av_tags())
                a = clean_card_html(card.answer(), card.answer_av_tags())
            except Exception as exc:  # template errors are shown, not raised
                q, a = f'<p class="render-error">{exc}</p>', ""
            if nt["type"] != 1 and (
                "front-of-card-is-blank" in q or not re.sub(r"<[^>]+>|\s", "", q)
            ):
                continue  # Anki would not generate this card
            cards.append({"label": label, "question": q, "answer": split_answer(a)})
        return {"cards": cards}
