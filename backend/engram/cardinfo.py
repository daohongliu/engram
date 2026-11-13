"""Shared helpers for describing cards: HTML clean-up, due dates, memory."""

from __future__ import annotations

import json
import math
import re
import time
from typing import Any

from anki.cards import Card
from anki.collection import Collection

from .fields import strip_payload

_STYLE_RE = re.compile(r"<style[^>]*>.*?</style>", re.S | re.I)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_AV_RE = re.compile(r"\[anki:play:([qa]):(\d+)\]")

QUEUE_NAMES = {
    -3: "buried",
    -2: "buried",
    -1: "suspended",
    0: "new",
    1: "learning",
    2: "review",
    3: "learning",
    4: "preview",
}


def clean_card_html(html: str, av_tags: list | None = None) -> str:
    """Drop notetype CSS and our source comments; turn audio tags into players."""
    html = _STYLE_RE.sub("", html)
    html = _COMMENT_RE.sub("", html)

    def audio(match: re.Match) -> str:
        idx = int(match.group(2))
        if av_tags and idx < len(av_tags):
            name = getattr(av_tags[idx], "filename", None)
            if name:
                return f'<audio controls preload="none" src="{name}"></audio>'
        return ""

    return _AV_RE.sub(audio, html).strip()


def split_answer(answer_html: str) -> str:
    """The part of an answer that is not a repeat of the question."""
    parts = re.split(r"<hr id=['\"]?answer['\"]?\s*/?>", answer_html, maxsplit=1)
    return parts[1].strip() if len(parts) == 2 else answer_html


def render_card(card: Card, browser: bool = False) -> dict[str, Any]:
    out = card.render_output(reload=True, browser=browser)
    q = clean_card_html(out.question_text, out.question_av_tags)
    a_full = clean_card_html(out.answer_text, out.answer_av_tags)
    if card.note_type()["type"] == 1:
        q, a_full = colour_clozes_in_maths(card, q, a_full)
    has_split = bool(re.search(r"<hr id=['\"]?answer", a_full))
    return {
        "question": q,
        "answer": split_answer(a_full),
        "answerFull": a_full,
        "answerRepeatsQuestion": has_split,
    }


# Maths in stored fields, and the deletions inside it.
_MATH_RE = re.compile(r"\\\(.*?\\\)|\\\[.*?\\\]", re.S)
_CLOZE_RE = re.compile(r"\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}", re.S)


def colour_clozes_in_maths(card: Card, question: str, answer: str) -> tuple[str, str]:
    """Show this card's deletions inside maths in the cloze colour.

    Outside maths Anki wraps a deletion in <span class="cloze">. Inside maths
    it can't, so the question shows a bare [...] and the answer the bare text,
    both typeset like the rest of the formula. For each formula in the note
    that holds one of this card's deletions, the formula Anki produced is
    found and replaced by one where that part is wrapped in \\htmlClass{cloze},
    which the frontend's KaTeX allows. Formulas that can't be found exactly
    are left as they are.
    """
    ordinal = str(card.ord + 1)
    for field in card.note().fields:
        for math in _MATH_RE.findall(field):
            if "{{c" not in math or not any(m.group(1) == ordinal for m in _CLOZE_RE.finditer(math)):
                continue

            def side(active, other=lambda m: m.group(2)):
                return _CLOZE_RE.sub(lambda m: active(m) if m.group(1) == ordinal else other(m), math)

            hidden = lambda m: f"[{m.group(3) or '...'}]"  # noqa: E731
            plain_q = side(hidden)
            plain_a = side(lambda m: m.group(2))
            question = question.replace(plain_q, side(lambda m: _cloze_tex(hidden(m))), 1)
            answer = answer.replace(plain_a, side(lambda m: _cloze_tex(m.group(2))), 1)
    return question, answer


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


def describe_due(col: Collection, ctype: int, queue: int, due: int, ivl: int) -> dict[str, Any]:
    """A human description of when a card is next shown."""
    today = col.sched.today
    state = QUEUE_NAMES.get(queue, "unknown")
    out: dict[str, Any] = {"state": state, "days": None, "label": ""}
    if queue == 0 or (queue < 0 and ctype == 0):
        out["label"] = "new"
        return out
    if queue == 1 or (queue == 4):
        secs = due - time.time()
        out["days"] = 0
        out["label"] = "now" if secs <= 0 else f"in {format_secs(secs)}"
        return out
    if queue in (2, 3) or queue < 0:
        if ctype in (1, 3) and due > 1_000_000_000:
            out["days"] = 0
            out["label"] = "today"
            return out
        days = due - today
        out["days"] = days
        if days < 0:
            out["label"] = f"{-days}d overdue"
        elif days == 0:
            out["label"] = "today"
        elif days == 1:
            out["label"] = "tomorrow"
        else:
            out["label"] = f"in {format_days(days)}"
    return out


def format_secs(secs: float) -> str:
    secs = max(0, int(secs))
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs // 60}m"
    if secs < 86400:
        return f"{secs // 3600}h"
    return format_days(secs // 86400)


def format_days(days: int) -> str:
    if days < 31:
        return f"{days}d"
    if days < 365:
        return f"{days / 30.4:.1f}mo".replace(".0mo", "mo")
    return f"{days / 365:.1f}y".replace(".0y", "y")


def memory_from_data(data: str) -> dict[str, Any] | None:
    """FSRS memory state from the card's JSON blob, with current recall odds."""
    if not data:
        return None
    try:
        blob = json.loads(data)
    except ValueError:
        return None
    stability = blob.get("s")
    difficulty = blob.get("d")
    if stability is None:
        return None
    decay = blob.get("decay") or 0.5
    out: dict[str, Any] = {
        "stability": round(stability, 2),
        # FSRS stores difficulty on a 1–10 scale; report it as 0–1, as Anki's UI does.
        "difficulty": round((difficulty - 1) / 9, 3) if difficulty is not None else None,
        "retrievability": None,
    }
    lrt = blob.get("lrt")
    if lrt:
        elapsed_days = max(0.0, (time.time() - lrt) / 86400)
        factor = math.pow(0.9, -1 / decay) - 1
        out["retrievability"] = round(math.pow(1 + factor * elapsed_days / max(stability, 0.01), -decay), 3)
    return out


def first_field_text(flds: str) -> str:
    return strip_payload(flds.split("\x1f", 1)[0])
