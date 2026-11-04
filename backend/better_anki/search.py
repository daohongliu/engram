"""Plain search: type words, get the cards that contain them.

The user never writes Anki's search language. Words are matched,
case- and accent-insensitively, against a card's visible text, its tags and
its deck name; every word must match somewhere. Deck, tag and state filters
come from the sidebar as structured parameters.

Anki does a fast first pass in Rust. Because Anki matches against raw field
HTML, a word like "width" or "strong" would also match markup, so the
candidates are then checked against the visible text only.
"""

from __future__ import annotations

import html as htmllib
import re
import unicodedata

from anki.collection import Collection

STATES = {
    "due": "is:due",
    "new": "is:new",
    "learning": "is:learn",
    "review": "is:review -is:learn",
    "suspended": "is:suspended",
    "buried": "is:buried",
    "flagged": "-flag:0",
    "image": '"<img"',
    "added-today": "added:1",
    "reviewed-today": "rated:1",
    "forgotten": "rated:7:1",
    "difficult": "prop:d>0.7",
}

_TAG_RE = re.compile(r"<[^>]*>")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_MATH_DELIMS = re.compile(r"\\[()\[\]]")


def _fold(text: str) -> str:
    """Lower-case and strip accents, so "Pólya" matches "polya"."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def visible_text(flds: str) -> str:
    text = _COMMENT_RE.sub(" ", flds.replace("\x1f", " "))
    text = _TAG_RE.sub(" ", text)
    text = _MATH_DELIMS.sub(" ", htmllib.unescape(text))
    return text


def _quote(value: str) -> str:
    """A literal Anki search term: no wildcards, no field or keyword syntax."""
    escaped = re.sub(r'([\\"*_:()])', r"\\\1", value)
    return f'"{escaped}"'


def _quote_exact(prefix: str, value: str) -> str:
    escaped = re.sub(r'([\\"*_])', r"\\\1", value)
    return f'"{prefix}{escaped}"'


def words(text: str) -> list[str]:
    return [w for w in text.split() if w.strip()]


def build_query(col: Collection, text: str, deck: str | None, tag: str | None, state: str | None) -> str:
    parts: list[str] = []
    if deck:
        parts.append(_quote_exact("deck:", deck))
    if tag:
        parts.append(_quote_exact("tag:", tag))
    if state and state in STATES:
        parts.append(STATES[state])
    for word in words(text):
        lit = re.sub(r'([\\"*_:()])', r"\\\1", word)
        parts.append(f'("nc:{lit}" or "tag:*{lit}*" or "deck:*{lit}*")')
    return " ".join(parts)


def refine(col: Collection, card_ids: list[int], text: str) -> list[int]:
    """Keep only cards whose visible text, tags or deck contain every word."""
    needles = [_fold(w) for w in words(text)]
    if not needles or not card_ids:
        return card_ids
    deck_names = {d.id: _fold(d.name) for d in col.decks.all_names_and_ids()}
    keep: set[int] = set()
    for i in range(0, len(card_ids), 900):
        chunk = card_ids[i : i + 900]
        rows = col.db.all(
            f"select c.id, n.flds, n.tags, c.did, c.odid from cards c join notes n on n.id = c.nid "
            f"where c.id in ({','.join('?' * len(chunk))})",
            *chunk,
        )
        for cid, flds, tags, did, odid in rows:
            hay = " ".join((_fold(visible_text(flds)), _fold(tags), deck_names.get(odid or did, "")))
            if all(n in hay for n in needles):
                keep.add(cid)
    return [cid for cid in card_ids if cid in keep]
