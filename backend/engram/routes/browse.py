from __future__ import annotations

import re
import time
from typing import Any, Literal

from anki.errors import NotFoundError, SearchError
from fastapi import APIRouter, HTTPException, Query
from google.protobuf.json_format import MessageToDict
from pydantic import BaseModel

from ..cardinfo import clean_card_html, describe_due, memory_from_data, render_card
from ..fields import decode_field, strip_payload
from ..search import build_query, refine
from ..store import collection, drop_unused_tags

router = APIRouter(prefix="/api", tags=["browse"])

ORDERS = {
    "added": "n.id {dir}, c.ord",
    "modified": "n.mod {dir}",
    "due": "(case when c.queue < 0 then 1 else 0 end), (case c.type when 0 then 1000000000 + c.due when 1 then 0 when 3 then 0 else c.due end) {dir}",
    "interval": "c.ivl {dir}",
    "lapses": "c.lapses {dir}",
    "reviews": "c.reps {dir}",
    "sortfield": "n.sfld collate nocase {dir}",
    "difficulty": "extract_fsrs_variable(c.data, 'd') {dir}",
}


@router.get("/search")
def search(
    text: str = "",
    deck: str | None = None,
    tag: str | None = None,
    state: str | None = None,
    order: str = "added",
    desc: bool = True,
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=500),
    cid: int | None = None,
    notes: bool = False,
) -> dict[str, Any]:
    """Cards matching the search, or with ``notes``, one entry per note.

    In notes mode an entry stands for a note and carries all its card ids;
    its scheduling details come from its first matching card (or ``cid``).
    """
    started = time.perf_counter()
    order_sql = ORDERS.get(order, ORDERS["added"]).format(dir="desc" if desc else "asc")
    with collection() as col:
        anki_query = f"cid:{cid}" if cid else build_query(col, text, deck, tag, state)
        try:
            ids = list(col.find_cards(anki_query, order=order_sql))
        except SearchError:
            # Our own query builder should never produce an invalid search;
            # if it somehow does, show nothing rather than an error.
            ids = []
        ids = refine(col, ids, text)
        if notes:
            groups = _first_card_per_note(col, ids)
            total, rows = len(groups), _note_rows(col, groups[offset : offset + limit])
        else:
            total, rows = len(ids), _rows(col, ids[offset : offset + limit])
        return {
            "total": total,
            "offset": offset,
            "rows": rows,
            "ms": round((time.perf_counter() - started) * 1000, 1),
        }


def _first_card_per_note(col, card_ids: list[int]) -> list[int]:
    """The first card of each note, in the order the notes first appear."""
    if not card_ids:
        return []
    nid_of = dict(col.db.all("select id, nid from cards"))
    seen: dict[int, int] = {}
    for cid in card_ids:
        seen.setdefault(nid_of[cid], cid)
    return list(seen.values())


# {{c1::text}} or {{c1::text::hint}}
_CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*?)?\}\}", re.S)
_MATH_RE = re.compile(r"(\\\(.*?\\\)|\\\[.*?\\\])", re.S)


def _field_html(raw: str) -> str:
    """A field for display, with every cloze deletion shown and highlighted.

    HTML inside maths would break the formula, so there a deletion is
    coloured with ``\\htmlClass{cloze}``, which the frontend's KaTeX allows.
    """
    parts = _MATH_RE.split(clean_card_html(strip_payload(raw)))
    return "".join(
        _CLOZE_RE.sub(lambda m: _cloze_tex(m.group(1)), part)
        if i % 2
        else _CLOZE_RE.sub(r'<span class="cloze">\1</span>', part)
        for i, part in enumerate(parts)
    )


def _cloze_tex(tex: str) -> str:
    """Wrap TeX in the cloze colour, unless its braces do not balance."""
    depth = 0
    for ch in re.sub(r"\\.", "", tex):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return tex
    return f"\\htmlClass{{cloze}}{{{tex}}}" if depth == 0 and tex.strip() else tex


def _note_rows(col, card_ids: list[int]) -> list[dict[str, Any]]:
    rows = _rows(col, card_ids, render=False)
    for row in rows:
        note = col.get_note(row["noteId"])
        fields = [_field_html(f) for f in note.fields]
        row["question"] = fields[0] if fields else ""
        row["answer"] = next((f for f in fields[1:] if f.strip()), "")
        row["cardIds"] = list(note.card_ids())
    return rows


def _rows(col, card_ids: list[int], render: bool = True) -> list[dict[str, Any]]:
    if not card_ids:
        return []
    placeholders = ",".join("?" * len(card_ids))
    raw = col.db.all(
        f"""select c.id, c.nid, c.did, c.odid, c.ord, c.type, c.queue,
                   (case when c.odid then c.odue else c.due end), c.ivl, c.reps, c.lapses,
                   c.flags, c.data, n.mid, n.tags, n.mod
            from cards c join notes n on n.id = c.nid
            where c.id in ({placeholders})""",
        *card_ids,
    )
    by_id = {r[0]: r for r in raw}
    deck_names = {d.id: d.name for d in col.decks.all_names_and_ids()}
    notetype_names = {m.id: m.name for m in col.models.all_names_and_ids()}
    rows = []
    for cid in card_ids:
        r = by_id.get(cid)
        if not r:
            continue
        (cid, nid, did, odid, ord_, ctype, queue, due, ivl, reps, lapses, flags, data, mid, tags, mod) = r
        rendered = render_card(col.get_card(cid), browser=True) if render else {"question": "", "answer": ""}
        rows.append(
            {
                "id": cid,
                "noteId": nid,
                "deck": deck_names.get(odid or did, "?"),
                "notetype": notetype_names.get(mid, "?"),
                "ord": ord_,
                "question": rendered["question"],
                "answer": rendered["answer"],
                "tags": tags.split(),
                "due": describe_due(col, ctype, queue, due, ivl),
                "interval": ivl,
                "reps": reps,
                "lapses": lapses,
                "flag": flags & 0b111,
                "memory": memory_from_data(data),
                "modified": mod,
            }
        )
    return rows


@router.get("/tags")
def tags() -> list[dict[str, Any]]:
    with collection() as col:
        counts: dict[str, int] = {}
        for (tagstr,) in col.db.all("select tags from notes where tags != ''"):
            for t in tagstr.split():
                counts[t] = counts.get(t, 0) + 1
        return [{"name": t, "notes": counts.get(t, 0)} for t in sorted(col.tags.all(), key=str.lower)]


@router.get("/cards/{card_id}")
def card_detail(card_id: int) -> dict[str, Any]:
    with collection() as col:
        try:
            card = col.get_card(card_id)
        except NotFoundError:
            raise HTTPException(404, "No such card.")
        note = card.note()
        notetype = note.note_type()
        stats = MessageToDict(col.card_stats_data(card_id), preserving_proto_field_name=False)
        data = col.db.scalar("select data from cards where id = ?", card_id)
        return {
            "id": card.id,
            "noteId": note.id,
            "deckId": card.current_deck_id(),
            "deck": col.decks.name(card.current_deck_id()),
            "notetype": {
                "id": notetype["id"],
                "name": notetype["name"],
                "isCloze": notetype["type"] == 1,
            },
            "template": card.template()["name"],
            "fields": [
                {"name": f["name"], **decode_field(note.fields[i]).__dict__}
                for i, f in enumerate(notetype["flds"])
            ],
            "tags": note.tags,
            "flag": card.user_flag(),
            "queue": card.queue,
            "due": describe_due(col, card.type, card.queue, card.odue if card.odid else card.due, card.ivl),
            "memory": memory_from_data(data),
            "stats": stats,
            "siblings": [cid for cid in note.card_ids() if cid != card_id],
            **render_card(card),
        }


class Bulk(BaseModel):
    ids: list[int]
    action: Literal[
        "suspend",
        "unsuspend",
        "bury",
        "unbury",
        "delete",
        "move",
        "addTags",
        "removeTags",
        "flag",
        "forget",
        "setDue",
    ]
    deckId: int | None = None
    tags: str | None = None
    flag: int | None = None
    days: str | None = None


@router.post("/cards/bulk")
def bulk(body: Bulk) -> dict[str, Any]:
    if not body.ids:
        return {"ok": True, "count": 0}
    with collection() as col:
        cids = body.ids
        nids = sorted({col.db.scalar("select nid from cards where id = ?", cid) for cid in cids} - {None})
        s = col.sched
        a = body.action
        if a == "suspend":
            s.suspend_cards(cids)
        elif a == "unsuspend":
            s.unsuspend_cards(cids)
        elif a == "bury":
            s.bury_cards(cids, manual=True)
        elif a == "unbury":
            s.unbury_cards(cids)
        elif a == "delete":
            col.remove_notes(nids)
            drop_unused_tags(col)
        elif a == "move":
            if body.deckId is None:
                raise HTTPException(400, "Move where?")
            col.set_deck(cids, body.deckId)
        elif a == "addTags":
            col.tags.bulk_add(nids, body.tags or "")
        elif a == "removeTags":
            col.tags.bulk_remove(nids, body.tags or "")
            drop_unused_tags(col)
        elif a == "flag":
            col.set_user_flag_for_cards(body.flag or 0, cids)
        elif a == "forget":
            s.schedule_cards_as_new(cids, restore_position=True, reset_counts=False)
        elif a == "setDue":
            s.set_due_date(cids, body.days or "0")
        return {"ok": True, "count": len(cids), "undo": col.undo_status().undo}


@router.get("/undo")
def undo_status() -> dict[str, Any]:
    with collection() as col:
        st = col.undo_status()
        return {"undo": st.undo or None, "redo": st.redo or None}


@router.post("/undo")
def undo() -> dict[str, Any]:
    with collection() as col:
        st = col.undo_status()
        if not st.undo:
            raise HTTPException(409, "Nothing to undo.")
        col.undo()
        return {"undid": st.undo}
