"""Studying: the next card to show, what comes after it, and answering.

A study session covers one deck (with its subdecks), a chosen set of decks
("12,34" in the URL), or every deck at once, which is deck id 0 (``ALL``).
Anki builds its queue for one deck at a time, so for several decks we ask
each one for its queue and interleave them, keeping each deck's own order.

Anki only accepts an answer for the card at the front of its queue. To let
you jump ahead to any waiting card, an answer for another card first resets
Anki's queue; both steps are recorded as one "Answer Card" undo step.
"""

from __future__ import annotations

import re
import time
from typing import Any

from anki.cards import Card
from anki.scheduler.v3 import CardAnswer
from anki.scheduler.v3 import QueuedCards
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..cardinfo import format_secs, memory_from_data, render_card
from ..store import collection, fold_into_step

router = APIRouter(prefix="/api/review", tags=["review"])

ALL = 0
UPCOMING = 20

_ISOLATE_RE = re.compile("[⁨⁩]")
_QUEUE_KIND = {0: "new", 1: "learn", 2: "review"}
_LEARNING = QueuedCards.LEARNING


def _select(col, deck_id: int) -> None:
    """Make ``deck_id`` the current deck.

    Anki records selecting a deck as its own undo step. Fold it into the
    previous step, so that undo keeps undoing the last real change.
    """
    if col.decks.get_current_id() == deck_id:
        return
    step = col.undo_status().last_step
    col.decks.select(deck_id)
    fold_into_step(col, step)


def _parse(spec: str) -> list[int]:
    """Deck ids from the URL: "0" for every deck, "12", or "12,34"."""
    try:
        ids = [int(part) for part in spec.split(",") if part.strip()]
    except ValueError:
        raise HTTPException(404, "No such deck.") from None
    if not ids:
        raise HTTPException(404, "No such deck.")
    return [ALL] if ALL in ids else list(dict.fromkeys(ids))


def _chosen(col, ids: list[int]) -> list[int]:
    """The chosen decks, leaving out any inside another chosen deck."""
    names = {i: col.decks.name(i) for i in ids}
    return [i for i in ids if not any(names[i].startswith(names[j] + "::") for j in ids if j != i)]


def _roots(col, ids: list[int]) -> list[int]:
    if ids != [ALL]:
        return _chosen(col, ids)
    return [
        n.deck_id
        for n in col.sched.deck_due_tree().children
        if n.new_count or n.learn_count or n.review_count
    ]


def _gather(col, ids: list[int]) -> tuple[list[tuple[int, Any]], dict[str, int]]:
    """Cards waiting in the session, in the order they will be shown.

    Returns ``(root deck id, queued card)`` pairs and the remaining counts.
    """
    lists: list[list[tuple[int, Any]]] = []
    counts = {"new": 0, "learn": 0, "review": 0}
    for root in _roots(col, ids):
        _select(col, root)
        q = col.sched.get_queued_cards(fetch_limit=UPCOMING + 1)
        counts["new"] += q.new_count
        counts["learn"] += q.learning_count
        counts["review"] += q.review_count
        lists.append([(root, qc) for qc in q.cards])
    return _interleave(_resume_turns(col, lists)), counts


def _resume_turns(col, lists: list[list[tuple[int, Any]]]) -> list[list[tuple[int, Any]]]:
    """Order the decks so taking turns carries on after the last answer.

    The decks take turns, one card each. Without this every call would start
    again from the first deck, so the second card in the session (and in Up
    next) would keep being pushed back by the first deck's next card.
    Starting after the deck of the most recently answered card makes the
    card shown next the one Up next listed first.
    """
    if len(lists) < 2:
        return lists
    row = col.db.first(
        "select c.did, c.odid from revlog r join cards c on c.id = r.cid order by r.id desc limit 1"
    )
    if not row:
        return lists
    name = col.decks.name(row[1] or row[0])
    roots = [cards[0][0] if cards else None for cards in lists]
    for i, root in enumerate(roots):
        if root is None:
            continue
        root_name = col.decks.name(root)
        if name == root_name or name.startswith(root_name + "::"):
            return lists[i + 1 :] + lists[: i + 1]
    return lists


def _interleave(lists: list[list[tuple[int, Any]]]) -> list[tuple[int, Any]]:
    # Learning cards that are due come first, as they do within a deck; then
    # take one card from each deck in turn. Each deck's order is kept, so the
    # first card is always at the front of its own deck's queue.
    out: list[tuple[int, Any]] = []
    for cards in lists:
        while cards and cards[0][1].queue == _LEARNING:
            out.append(cards.pop(0))
    while any(lists):
        for cards in lists:
            if cards:
                out.append(cards.pop(0))
    return out


def _session_name(col, ids: list[int]) -> str:
    if ids == [ALL]:
        return "All decks"
    roots = _chosen(col, ids)
    if len(roots) == 1:
        return col.decks.name(roots[0])
    return ", ".join(col.decks.name(i).split("::")[-1] for i in roots)


def _check_decks(col, ids: list[int]) -> None:
    if ids != [ALL] and not all(col.decks.get(i, default=False) for i in ids):
        raise HTTPException(404, "No such deck.")


@router.get("/{decks}/next")
def next_card(decks: str, cardId: int | None = None) -> dict[str, Any]:
    """The card to show now: ``cardId`` if it is waiting, otherwise the next one."""
    with collection() as col:
        ids = _parse(decks)
        _check_decks(col, ids)
        waiting, counts = _gather(col, ids)
        name = _session_name(col, ids)
        if not waiting:
            return {"done": True, "deckName": name, "counts": counts, "congrats": _congrats(col, ids)}

        index = next((i for i, (_, qc) in enumerate(waiting) if qc.card.id == cardId), 0)
        current = waiting[index][1]
        card = Card(col)
        card._load_from_backend_card(current.card)
        note = card.note()
        labels = [_ISOLATE_RE.sub("", s) for s in col.sched.describe_next_states(current.states)]
        last_review = col.db.scalar("select max(id) from revlog where cid = ?", card.id)
        others = [qc for i, (_, qc) in enumerate(waiting) if i != index][:UPCOMING]
        return {
            "done": False,
            "deckName": name,
            "counts": counts,
            "queue": _QUEUE_KIND.get(int(current.queue), "review"),
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
                **render_card(card),
            },
            "upcoming": [_upcoming(col, qc) for qc in others],
        }


def _upcoming(col, qc) -> dict[str, Any]:
    card = Card(col)
    card._load_from_backend_card(qc.card)
    return {
        "id": card.id,
        "deck": col.decks.name(card.current_deck_id()),
        "queue": _QUEUE_KIND.get(int(qc.queue), "review"),
        "question": render_card(card, browser=True)["question"],
    }


def _congrats(col, ids: list[int]) -> dict[str, Any]:
    if ids == [ALL]:
        roots = [n.deck_id for n in col.sched.deck_due_tree().children]
    else:
        roots = _chosen(col, ids)
    learn = 0
    secs: list[int] = []
    review = new = buried = False
    for root in roots:
        _select(col, root)
        info = col.sched.congratulations_info()
        learn += info.learn_remaining
        if info.learn_remaining:
            secs.append(info.secs_until_next_learn)
        review |= info.review_remaining
        new |= info.new_remaining
        buried |= info.have_sched_buried or info.have_user_buried
    soonest = min(secs) if secs else 0
    return {
        "learnRemaining": learn,
        "secsUntilNextLearn": soonest,
        "nextLearnLabel": format_secs(soonest) if learn else None,
        "reviewRemaining": review,
        "newRemaining": new,
        "haveBuried": buried,
        "studiedToday": _studied_today(col),
    }


def _studied_today(col) -> dict[str, int]:
    cutoff = (col.sched.day_cutoff - 86400) * 1000
    row = col.db.first("select count(), coalesce(sum(time), 0) from revlog where id > ?", cutoff)
    return {"cards": row[0], "seconds": row[1] // 1000}


class Answer(BaseModel):
    cardId: int
    rating: int = Field(ge=1, le=4)
    ms: int = Field(default=10_000, ge=0)


_RATINGS = {1: CardAnswer.AGAIN, 2: CardAnswer.HARD, 3: CardAnswer.GOOD, 4: CardAnswer.EASY}


@router.post("/{decks}/answer")
def answer(decks: str, body: Answer) -> dict[str, Any]:
    with collection() as col:
        ids = _parse(decks)
        _check_decks(col, ids)
        waiting, _ = _gather(col, ids)
        root = next((r for r, qc in waiting if qc.card.id == body.cardId), None)
        if root is None:
            raise HTTPException(409, "That card is no longer waiting for an answer.")

        _select(col, root)
        front = col.sched.get_queued_cards(fetch_limit=1).cards
        card = col.get_card(body.cardId)
        card.timer_started = time.time() - min(body.ms, 600_000) / 1000
        rating = _RATINGS[body.rating]
        if front and front[0].card.id == body.cardId:
            col.sched.answer_card(col.sched.build_answer(card=card, states=front[0].states, rating=rating))
        else:
            # Jumped ahead: saving the card resets Anki's queue, which would
            # otherwise refuse an answer for anything but its front card.
            step = col.add_custom_undo_entry("Answer Card")
            col.update_card(card)
            states = col._backend.get_scheduling_states(body.cardId)
            card = col.get_card(body.cardId)
            card.timer_started = time.time() - min(body.ms, 600_000) / 1000
            col.sched.answer_card(col.sched.build_answer(card=card, states=states, rating=rating))
            col.merge_undo_entries(step)
        return {"ok": True}
