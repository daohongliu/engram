"""Studying ahead: cards due in the next few days, before they are due.

Built on Anki's filtered decks, as Anki's own "Review ahead" is. The
matching cards move into a temporary deck called "Study ahead", which is
studied like any other deck. Answers count as real reviews (the scheduler
allows for a card being reviewed early), answered cards go back to their
own decks, and removing the deck returns any that are left.

The cards can come from every deck or from chosen ones, and be narrowed by
tags: any or all of some tags, and none of others.
"""

from __future__ import annotations

from typing import Any, Literal

from anki.collection import SearchNode
from anki.decks import FilteredDeckConfig
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..store import collection

router = APIRouter(prefix="/api/ahead", tags=["study ahead"])

DECK_NAME = "Study ahead"
Order = FilteredDeckConfig.SearchTerm


class AheadIn(BaseModel):
    decks: list[int] = Field(default_factory=list, description="Empty for every deck")
    tags: list[str] = Field(default_factory=list)
    tagMode: Literal["any", "all"] = "any"
    excludeTags: list[str] = Field(default_factory=list)
    days: int = Field(7, ge=0, le=365, description="Cards due within this many days; 0 for today only")
    newCards: int = Field(0, ge=0, le=9999)
    limit: int = Field(200, ge=1, le=9999, description="At most this many cards that are not new")


def _scope(col, body: AheadIn) -> str:
    nodes: list[Any] = []
    if body.decks:
        names = {}
        for did in body.decks:
            deck = col.decks.get(did, default=False)
            if not deck:
                raise HTTPException(404, "No such deck.")
            names[did] = deck["name"]
        # A deck inside another chosen deck is already included.
        roots = [n for d, n in names.items() if not any(n.startswith(o + "::") for e, o in names.items() if e != d)]
        nodes.append(col.group_searches(*[SearchNode(deck=n) for n in roots], joiner="OR"))
    tags = [t.strip() for t in body.tags if t.strip()]
    if tags:
        nodes.append(col.group_searches(*[SearchNode(tag=t) for t in tags], joiner="OR" if body.tagMode == "any" else "AND"))
    for t in body.excludeTags:
        if t.strip():
            nodes.append(SearchNode(negated=SearchNode(tag=t.strip())))
    # Bracketed, so an OR inside can't swallow the conditions added after it.
    return f"({col.build_search_string(*nodes)})" if nodes else ""


def _terms(col, body: AheadIn) -> tuple[str, str | None]:
    scope = _scope(col, body)
    within = "is:due" if body.days == 0 else f"(is:due OR prop:due<={body.days})"
    reviews = f"{scope} {within} -is:new".strip()
    new = f"{scope} is:new".strip() if body.newCards else None
    return reviews, new


def _own_deck(col) -> int | None:
    deck = col.decks.by_name(DECK_NAME)
    return deck["id"] if deck and deck.get("dyn") else None


def _count(col, search: str, own: int | None) -> int:
    # Cards in other filtered decks can't be pulled in; ours is rebuilt.
    elsewhere = f"(-deck:filtered OR did:{own})" if own else "-deck:filtered"
    return len(col.find_cards(f"({search}) {elsewhere} -is:suspended -is:buried"))


@router.post("/preview")
def preview(body: AheadIn) -> dict[str, int]:
    """How many cards a study-ahead session with these settings would have."""
    with collection() as col:
        reviews, new = _terms(col, body)
        own = _own_deck(col)
        r = min(_count(col, reviews, own), body.limit)
        n = min(_count(col, new, own), body.newCards) if new else 0
        return {"reviews": r, "new": n, "total": r + n}


@router.post("")
def start(body: AheadIn) -> dict[str, Any]:
    """Fill the "Study ahead" deck with the matching cards; returns its id."""
    with collection() as col:
        reviews, new = _terms(col, body)
        own = _own_deck(col)
        if col.decks.by_name(DECK_NAME) and own is None:
            raise HTTPException(409, f'A normal deck is called "{DECK_NAME}"; rename it to study ahead.')
        deck = col.sched.get_or_create_filtered_deck(deck_id=own or 0)
        deck.name = DECK_NAME
        del deck.config.search_terms[:]
        deck.config.search_terms.append(Order(search=reviews, limit=body.limit, order=Order.DUE))
        if new:
            deck.config.search_terms.append(Order(search=new, limit=body.newCards, order=Order.ADDED))
        deck.config.reschedule = True
        try:
            did = col.sched.add_or_update_filtered_deck(deck).id
        except Exception as exc:  # Anki refuses when nothing matches
            if own is None and (made := _own_deck(col)):
                col.decks.remove([made])
            raise HTTPException(400, "No cards match these settings.") from exc
        total = len(col.find_cards(f"did:{did}"))
        if not total:
            col.decks.remove([did])
            raise HTTPException(400, "No cards match these settings.")
        return {"deckId": did, "total": total}
