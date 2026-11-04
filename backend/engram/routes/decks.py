from __future__ import annotations

from typing import Any

from anki.errors import NotFoundError
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..store import collection

router = APIRouter(prefix="/api/decks", tags=["decks"])


def _node(node: Any, parent: str = "") -> dict[str, Any]:
    full = f"{parent}::{node.name}" if parent else node.name
    return {
        "id": node.deck_id,
        "name": node.name,
        "fullName": full,
        "new": node.new_count,
        "learn": node.learn_count,
        "review": node.review_count,
        "total": node.total_including_children,
        "filtered": node.filtered,
        "collapsed": node.collapsed,
        "children": [_node(c, full) for c in node.children],
    }


@router.get("")
def list_decks() -> dict[str, Any]:
    with collection() as col:
        tree = col.sched.deck_due_tree()
        decks = [_node(c) for c in tree.children]
        # Hide the built-in "Default" deck when it is empty and unused,
        # as Anki desktop does.
        decks = [
            d
            for d in decks
            if not (d["id"] == 1 and d["total"] == 0 and not d["children"] and len(decks) > 1)
        ]
        return {
            "decks": decks,
            "totals": {
                "new": sum(d["new"] for d in decks),
                "learn": sum(d["learn"] for d in decks),
                "review": sum(d["review"] for d in decks),
            },
        }


class DeckCreate(BaseModel):
    name: str


@router.post("")
def create_deck(body: DeckCreate) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "A deck needs a name.")
    with collection() as col:
        if col.decks.id_for_name(name):
            raise HTTPException(409, f"There is already a deck called “{name}”.")
        out = col.decks.add_normal_deck_with_name(name)
        return {"id": out.id, "name": name}


class DeckRename(BaseModel):
    name: str


@router.patch("/{deck_id}")
def rename_deck(deck_id: int, body: DeckRename) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "A deck needs a name.")
    with collection() as col:
        try:
            col.decks.rename(deck_id, name)
        except NotFoundError:
            raise HTTPException(404, "No such deck.")
        except Exception as exc:  # name clash and similar
            raise HTTPException(400, str(exc))
        return {"id": deck_id, "name": name}


@router.delete("/{deck_id}")
def delete_deck(deck_id: int) -> dict[str, Any]:
    with collection() as col:
        out = col.decks.remove([deck_id])
        return {"removedCards": out.count}


class DeckOptions(BaseModel):
    newPerDay: int | None = None
    reviewsPerDay: int | None = None
    desiredRetention: float | None = None


@router.get("/{deck_id}/options")
def get_options(deck_id: int) -> dict[str, Any]:
    with collection() as col:
        deck = col.decks.get(deck_id, default=False)
        if not deck:
            raise HTTPException(404, "No such deck.")
        if deck.get("dyn"):
            return {"filtered": True}
        conf = col.decks.config_dict_for_deck_id(deck_id)
        shared = len(col.decks.decks_using_config(conf))
        return {
            "filtered": False,
            "preset": conf["name"],
            "sharedWith": shared,
            "newPerDay": conf["new"]["perDay"],
            "reviewsPerDay": conf["rev"]["perDay"],
            "desiredRetention": conf.get("desiredRetention", 0.9),
            "fsrs": bool(col.get_config("fsrs", False)),
        }


@router.put("/{deck_id}/options")
def set_options(deck_id: int, body: DeckOptions) -> dict[str, Any]:
    with collection() as col:
        conf = col.decks.config_dict_for_deck_id(deck_id)
        if body.newPerDay is not None:
            conf["new"]["perDay"] = max(0, min(9999, body.newPerDay))
        if body.reviewsPerDay is not None:
            conf["rev"]["perDay"] = max(0, min(99999, body.reviewsPerDay))
        if body.desiredRetention is not None:
            conf["desiredRetention"] = max(0.7, min(0.99, body.desiredRetention))
        col.decks.update_config(conf)
    return get_options(deck_id)
