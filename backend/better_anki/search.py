"""A friendlier front door to Anki's search language.

Everything Anki understands still works. On top of that we accept a couple
of shorthands borrowed from note-taking apps:

* ``#calculus``         → ``tag:calculus``  (and its sub-tags)
* ``@analysis``         → ``deck:*analysis*`` (substring match on deck name)
* ``@"linear algebra"`` → ``"deck:*linear algebra*"``
* ``-#todo``            → ``-tag:todo``

and a handful of readable aliases for common states, plus ``has:image``.
"""

from __future__ import annotations

ALIASES = {
    "is:hard": "prop:d>0.7",
    "is:fragile": "prop:r<0.8",
    "is:today": "rated:1",
    "is:fresh": "added:1",
    "is:flagged": "-flag:0",
    "is:leech": "tag:leech",
    "has:image": '"<img"',
}


def tokenize(query: str) -> list[str]:
    """Split on whitespace, keeping quoted runs and parentheses intact."""
    tokens: list[str] = []
    buf = ""
    in_quote = False
    i = 0
    while i < len(query):
        ch = query[i]
        if ch == "\\" and i + 1 < len(query):
            buf += query[i : i + 2]
            i += 2
            continue
        if ch == '"':
            in_quote = not in_quote
            buf += ch
        elif not in_quote and ch.isspace():
            if buf:
                tokens.append(buf)
            buf = ""
        elif not in_quote and ch in "()" and not buf.endswith(":"):
            if buf:
                tokens.append(buf)
            tokens.append(ch)
            buf = ""
        else:
            buf += ch
        i += 1
    if buf:
        tokens.append(buf)
    return tokens


def _unquote(text: str) -> str:
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    return text


def _quote_if_needed(term: str) -> str:
    return f'"{term}"' if any(c.isspace() for c in term) else term


def translate_token(token: str) -> str:
    neg = ""
    body = token
    if body.startswith("-") and len(body) > 1:
        neg, body = "-", body[1:]
    lower = body.lower()
    if lower in ALIASES:
        return neg + ALIASES[lower]
    if body.startswith("#") and len(body) > 1:
        return neg + _quote_if_needed("tag:" + _unquote(body[1:]))
    if body.startswith("@") and len(body) > 1:
        name = _unquote(body[1:])
        if not name.startswith("*"):
            name = "*" + name
        if not name.endswith("*"):
            name = name + "*"
        return neg + _quote_if_needed("deck:" + name)
    return token


def translate(query: str) -> str:
    return " ".join(translate_token(t) for t in tokenize(query.strip()))
