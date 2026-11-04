from __future__ import annotations

import re
import time
from typing import Any

from anki.cards import Card
from anki.scheduler.v3 import CardAnswer
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..cardinfo import format_secs, memory_from_data, render_card
from ..store import collection

router = APIRouter(prefix="/api/review", tags=["review"])

_ISOLATE_RE = re.compile("[⁨⁩]")
_QUEUE_KIND = {0: "new", 1: "learn", 2: "review"}


def _queue(col, deck_id: int):
    if col.decks.get_current_id() != deck_id:
        col.decks.select(deck_id)
    return col.sched.get_queued_cards(fetch_limit=8)


@router.get("/{deck_id}/next")
def next_card(deck_id: int) -> dict[str, Any]:
    with collection() as col:
        if not col.decks.get(deck_id, default=False):
            raise HTTPException(404, "No such deck.")
        queued = _queue(col, deck_id)
        counts = {
            "new": queued.new_count,
            "learn": queued.learning_count,
            "review": queued.review_count,
        }
        deck_name = col.decks.name(deck_id)
        if not queued.cards:
            info = col.sched.congratulations_info()
            return {
                "done": True,
                "deckName": deck_name,
                "counts": counts,
                "congrats": {
                    "learnRemaining": info.learn_remaining,
                    "secsUntilNextLearn": info.secs_until_next_learn,
                    "nextLearnLabel": format_secs(info.secs_until_next_learn)
                    if info.learn_remaining
                    else None,
                    "reviewRemaining": info.review_remaining,
                    "newRemaining": info.new_remaining,
                    "haveBuried": info.have_sched_buried or info.have_user_buried,
                    "studiedToday": _studied_today(col),
                },
            }
        top = queued.cards[0]
        card = Card(col)
        card._load_from_backend_card(top.card)
        note = card.note()
        labels = [_ISOLATE_RE.sub("", s) for s in col.sched.describe_next_states(top.states)]
        rendered = render_card(card)
        last_review = col.db.scalar("select max(id) from revlog where cid = ?", card.id)
        return {
            "done": False,
            "deckName": deck_name,
            "counts": counts,
            "queue": _QUEUE_KIND.get(int(top.queue), "review"),
            "intervals": labels,
            "card": {
                "id": card.id,
                "noteId": note.id,
                "deck": col.decks.name(card.current_deck_id()),
                "notetype": note.note_type()["name"],
                "template": card.template()["name"],
                "tags": note.tags,
                "flag": card.user_flag(),
                "reps": card.reps,
                "lapses": card.lapses,
                "isNew": card.type == 0,
                "lastReviewed": (last_review // 1000) if last_review else None,
                "memory": memory_from_data(col.db.scalar("select data from cards where id = ?", card.id)),
                **rendered,
            },
        }


def _studied_today(col) -> dict[str, int]:
    cutoff = (col.sched.day_cutoff - 86400) * 1000
    row = col.db.first("select count(), coalesce(sum(time), 0) from revlog where id > ?", cutoff)
    return {"cards": row[0], "seconds": row[1] // 1000}


class Answer(BaseModel):
    cardId: int
    rating: int = Field(ge=1, le=4)
    ms: int = Field(default=10_000, ge=0)


@router.post("/{deck_id}/answer")
def answer(deck_id: int, body: Answer) -> dict[str, Any]:
    with collection() as col:
        queued = _queue(col, deck_id)
        match = next((qc for qc in queued.cards if qc.card.id == body.cardId), None)
        if match is None:
            raise HTTPException(409, "That card is no longer waiting for an answer.")
        card = Card(col)
        card._load_from_backend_card(match.card)
        card.timer_started = time.time() - min(body.ms, 600_000) / 1000
        rating = {
            1: CardAnswer.AGAIN,
            2: CardAnswer.HARD,
            3: CardAnswer.GOOD,
            4: CardAnswer.EASY,
        }[body.rating]
        col.sched.answer_card(col.sched.build_answer(card=card, states=match.states, rating=rating))
        return {"ok": True}
