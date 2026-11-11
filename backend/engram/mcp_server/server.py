"""MCP tools for Engram, served over streamable HTTP behind OAuth.

Every tool is a wrapper over Engram's own REST API, called in the same
process, so the agent can do anything the interface can do. New cards go to
the "AI inbox" deck by default (tagged `ai`, otherwise ordinary cards) so the
user can look them over and file them, but any deck can be targeted.

Configured with environment variables; see run_mcp in engram/__main__.py.
"""

from __future__ import annotations

import base64
import html
import json
import os
import re
from pathlib import Path
from typing import Annotated, Any, Literal

import httpx
from pydantic import BaseModel, Field
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from mcp.server import MCPServer
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings

from ..store import DEFAULT_PATH
from .oauth import SingleUserProvider

PUBLIC_URL = os.environ.get("ENGRAM_MCP_PUBLIC_URL", "http://127.0.0.1:8001").rstrip("/")
INBOX = os.environ.get("ENGRAM_MCP_INBOX", "AI inbox")
AI_TAG = "ai"
# Sign-in state lives next to the collection, in data/ by default.
_COLLECTION = os.environ.get("ENGRAM_COLLECTION") or os.environ.get("BETTER_ANKI_COLLECTION") or DEFAULT_PATH
DB_PATH = os.environ.get("ENGRAM_MCP_DB") or str(Path(_COLLECTION).expanduser().resolve().parent / "mcp.db")
PASSWORD_HASH = os.environ.get("ENGRAM_MCP_PASSWORD_HASH", "")
SCOPE = "engram"

INSTRUCTIONS = f"""Engram is the user's flashcard app (Anki-compatible, FSRS scheduling). You have
full access: anything the user can do in Engram's interface, you can do with these tools.

Making cards:
1. Call get_card_conventions once per conversation (formatting rules, the user's LaTeX macros).
2. Call search_cards on the topic so you don't duplicate cards the user already has.
3. Call add_notes. By default cards go to the "{INBOX}" deck, where the user looks them
   over, then files, edits or deletes them. Put them straight into another deck only when
   the user asks for that (or a workflow they set up says so). Every card you add is
   tagged `{AI_TAG}`; add other tags only if the user wants them.
4. Report what was created, skipped as duplicate, or rejected; fix rejected ones.

Changing things: use update_note, modify_cards (move, tag, suspend, flag, reschedule,
delete…), the deck tools, and undo. For anything else in Engram (reviewing, statistics,
settings, previews), call engram_api_reference, then engram_api.
Deleting notes or decks is real; the user can usually recover with undo right after."""

CONVENTIONS = r"""Card conventions for Engram

Fields are Markdown. Maths is LaTeX between $...$ (inline) or $$...$$ (display, on its own
lines). Do not use \( \) or \[ \].

Basic notes have a front (the question) and a back (the answer). Cloze notes have a text
with deletions {{c1::...}}, {{c2::...}} and an optional extra field shown on the back.
Deletions with different numbers become separate cards; give several deletions the same
number (all c1) to hide them together on one card. A cloze inside maths works:
$\sum_{n=1}^\infty {{c1::\frac{1}{n^2}}} = \frac{\pi^2}{6}$.

Good cards:
- One fact or idea per card.
- Prefer cloze for definitions and theorem statements; prefer basic for "why", "how" and
  "give an example" questions.
- State the context ("In a metric space, ...") so the card makes sense months later.
- Keep answers short. A proof idea fits on a card; a full proof does not.
- Use the user's notation and the source's names for results.

Images: upload with add_image and put the returned Markdown in a field. Width can be set
with ![caption|300](file.png)."""

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _text(fragment: str, limit: int = 400) -> str:
    """Card HTML as plain text, for showing search results to the model."""
    t = html.unescape(_TAG_RE.sub(" ", fragment or ""))
    t = _WS_RE.sub(" ", t).strip()
    return t if len(t) <= limit else t[: limit - 1] + "…"


def _tag(s: str) -> str:
    """Make a string usable as an Anki tag (no spaces)."""
    return re.sub(r"\s+", "_", s.strip())[:80]


class EngramError(ToolError):
    """An error the model should see (bad input, or Engram refused the request)."""


class Engram:
    """Engram's REST API, called in this process without going over the network."""

    def __init__(self):
        from ..app import app

        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://engram", timeout=30)

    async def call(self, method: str, path: str, **kw) -> Any:
        r = await self.http.request(method, path, **kw)
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except Exception:
                detail = r.text[:200]
            if not isinstance(detail, str):
                detail = json.dumps(detail)[:500]
            raise EngramError(f"{detail or r.reason_phrase} (HTTP {r.status_code})")
        if not r.content:
            return None
        try:
            return r.json()
        except ValueError:
            return r.text

    async def notetypes(self) -> tuple[dict, dict]:
        types = await self.call("GET", "/api/notetypes")
        basic = next((t for t in types if t["name"] == "Basic"), None) or next(
            t for t in types if not t["isCloze"] and len(t["fields"]) >= 2
        )
        cloze = next((t for t in types if t["name"] == "Cloze"), None) or next(t for t in types if t["isCloze"])
        return basic, cloze

    async def deck_ids(self) -> dict[str, int]:
        out: dict[str, int] = {}

        def walk(nodes):
            for n in nodes:
                out[n["fullName"]] = n["id"]
                walk(n["children"])

        walk((await self.call("GET", "/api/decks"))["decks"])
        return out

    async def deck_id(self, name: str, create: bool = False) -> int:
        ids = await self.deck_ids()
        if name in ids:
            return ids[name]
        lower = {k.lower(): v for k, v in ids.items()}
        if name.lower() in lower:
            return lower[name.lower()]
        if not create:
            raise EngramError(f"No deck called '{name}'. Decks: {sorted(ids)}")
        try:
            return (await self.call("POST", "/api/decks", json={"name": name}))["id"]
        except EngramError:
            ids = await self.deck_ids()
            if name in ids:
                return ids[name]
            raise

    async def card_ids(self, note_ids: list[int] | None, card_ids: list[int] | None) -> list[int]:
        out = list(card_ids or [])
        for nid in note_ids or []:
            out += (await self.call("GET", f"/api/notes/{nid}"))["cardIds"]
        if not out:
            raise EngramError("Give note_ids or card_ids.")
        return sorted(set(out))


engram = Engram()


# ---------------------------------------------------------------- server

provider = SingleUserProvider(DB_PATH, PUBLIC_URL, f"{PUBLIC_URL}/mcp", PASSWORD_HASH)

mcp = MCPServer(
    name="Engram",
    instructions=INSTRUCTIONS,
    auth_server_provider=provider,
    auth=AuthSettings(
        issuer_url=PUBLIC_URL,
        resource_server_url=f"{PUBLIC_URL}/mcp",
        validate_token_resource=False,  # checked in SingleUserProvider.load_access_token
        required_scopes=[SCOPE],
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]
        ),
        revocation_options=RevocationOptions(enabled=True),
    ),
)


@mcp.custom_route("/oauth/login", methods=["GET", "POST"])
async def oauth_login(request: Request) -> Response:
    return await provider.login_page(request)


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(request: Request) -> Response:
    try:
        await engram.call("GET", "/api/decks")
        return JSONResponse({"ok": True})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)


# ---------------------------------------------------------------- reading


@mcp.tool()
async def get_card_conventions() -> str:
    """Formatting rules for Engram cards (Markdown, LaTeX, cloze syntax, images) and the
    user's LaTeX macros. Call this once before writing cards."""
    settings = await engram.call("GET", "/api/settings")
    macros = (settings.get("preamble") or "").strip()
    return CONVENTIONS + ("\n\nThe user's LaTeX macros (available in every card):\n" + macros if macros else "")


@mcp.tool()
async def list_decks() -> list[dict[str, Any]]:
    """All decks with their full names (subdecks use ::), ids and card counts."""
    out: list[dict[str, Any]] = []

    def walk(nodes):
        for n in nodes:
            out.append({"name": n["fullName"], "id": n["id"], "cards": n["total"],
                        "due": n["review"] + n["learn"], "new": n["new"]})
            walk(n["children"])

    walk((await engram.call("GET", "/api/decks"))["decks"])
    return out


@mcp.tool()
async def search_cards(
    text: Annotated[str, Field(description="Words that must all appear (in card text, tags or deck name). Empty for any.")] = "",
    deck: Annotated[str | None, Field(description="Full deck name; includes its subdecks.")] = None,
    tag: str | None = None,
    state: Annotated[
        Literal["due", "new", "learning", "review", "suspended", "buried", "flagged", "image",
                "added-today", "reviewed-today", "forgotten", "difficult"] | None,
        Field(description="'forgotten' = failed in the last week; 'difficult' = high FSRS difficulty."),
    ] = None,
    order: Literal["added", "modified", "due", "interval", "lapses", "reviews", "sortfield", "difficulty"] = "added",
    descending: bool = True,
    offset: Annotated[int, Field(ge=0)] = 0,
    limit: Annotated[int, Field(ge=1, le=200)] = 30,
) -> dict[str, Any]:
    """Search the user's notes (one entry per note, with its card ids)."""
    params: dict[str, Any] = {"text": text, "notes": "true", "limit": limit, "offset": offset,
                              "order": order, "desc": str(descending).lower()}
    for k, v in (("deck", deck), ("tag", tag), ("state", state)):
        if v:
            params[k] = v
    res = await engram.call("GET", "/api/search", params=params)
    return {
        "total": res["total"],
        "notes": [
            {"noteId": r["noteId"], "cardIds": r.get("cardIds"), "deck": r["deck"], "type": r["notetype"],
             "tags": r["tags"], "front": _text(r["question"]), "back": _text(r["answer"]),
             "due": r.get("due"), "lapses": r.get("lapses"), "flag": r.get("flag")}
            for r in res["rows"]
        ],
    }


@mcp.tool()
async def get_note(note_id: int) -> dict[str, Any]:
    """One note with each field's Markdown source, its tags and card ids."""
    n = await engram.call("GET", f"/api/notes/{note_id}")
    return {
        "noteId": n["id"],
        "type": n["notetype"]["name"],
        "fields": {f["name"]: f["source"] for f in n["fields"]},
        "tags": n["tags"],
        "cardIds": n["cardIds"],
    }


# ---------------------------------------------------------------- writing


class NewNote(BaseModel):
    kind: Literal["basic", "cloze"]
    front: str | None = Field(None, description="basic: the question (Markdown + $LaTeX$)")
    back: str | None = Field(None, description="basic: the answer")
    text: str | None = Field(None, description="cloze: text with {{c1::...}} deletions")
    extra: str | None = Field(None, description="cloze: optional extra shown on the back")
    tags: list[str] = Field(default_factory=list, description="Extra tags, only if the user wants them")
    deck: str | None = Field(None, description="Override the batch's deck for this note")


@mcp.tool()
async def add_notes(
    notes: Annotated[list[NewNote], Field(min_length=1, max_length=200)],
    deck: Annotated[
        str, Field(description=f"Full deck name. Default '{INBOX}', where the user reviews new cards. "
                               "Created if it doesn't exist.")
    ] = INBOX,
    allow_duplicates: bool = False,
) -> dict[str, Any]:
    """Create basic or cloze notes. They are ordinary cards (not suspended), tagged `ai`."""
    basic, cloze = await engram.notetypes()
    deck_cache: dict[str, int] = {}

    async def did(name: str) -> int:
        if name not in deck_cache:
            deck_cache[name] = await engram.deck_id(name, create=True)
        return deck_cache[name]

    created, skipped, rejected = [], [], []
    for i, n in enumerate(notes):
        if n.kind == "basic":
            if not (n.front or "").strip() or not (n.back or "").strip():
                rejected.append({"index": i, "reason": "basic notes need front and back"})
                continue
            nt, fields = basic, [n.front, n.back]
        else:
            if not (n.text or "").strip():
                rejected.append({"index": i, "reason": "cloze notes need text"})
                continue
            nt, fields = cloze, [n.text, n.extra or ""]
        tags = [AI_TAG] + [_tag(t) for t in n.tags if t.strip() and _tag(t) != AI_TAG]
        target = n.deck or deck
        try:
            res = await engram.call(
                "POST", "/api/notes",
                json={"notetypeId": nt["id"], "deckId": await did(target), "fields": fields, "tags": tags},
            )
        except EngramError as exc:
            rejected.append({"index": i, "reason": str(exc)})
            continue
        if res.get("warning") and "already exists" in res["warning"] and not allow_duplicates:
            await engram.call("DELETE", f"/api/notes/{res['noteId']}")
            skipped.append({"index": i, "reason": "duplicate of an existing note"})
            continue
        created.append({"index": i, "noteId": res["noteId"], "deck": target, "cards": len(res["cardIds"])})

    return {"created": created, "skipped": skipped, "rejected": rejected}


@mcp.tool()
async def update_note(
    note_id: int,
    fields: Annotated[dict[str, str], Field(description="Field name -> new Markdown. Omitted fields stay.")] = {},
    tags: Annotated[list[str] | None, Field(description="Full new tag list; omit to keep the current tags.")] = None,
    deck: Annotated[str | None, Field(description="Move all the note's cards to this deck.")] = None,
) -> dict[str, Any]:
    """Change a note's fields, tags and/or deck."""
    n = await engram.call("GET", f"/api/notes/{note_id}")
    names = [f["name"] for f in n["fields"]]
    unknown = set(fields) - set(names)
    if unknown:
        raise EngramError(f"Unknown field(s) {sorted(unknown)}; this note has {names}.")
    changed = False
    new_fields = [fields.get(f["name"], f["source"]) for f in n["fields"]]
    if fields or deck:
        # Tags are sent unchanged here and changed separately below: Engram's PUT fails
        # ("target undo op not found") when one edit changes the tags of a note whose
        # fields were just edited, so tag changes go through the bulk tag actions.
        body: dict[str, Any] = {"fields": new_fields, "tags": n["tags"]}
        if deck:
            body["deckId"] = await engram.deck_id(deck)
        res = await engram.call("PUT", f"/api/notes/{note_id}", json=body)
        changed = bool(res.get("changed")) or bool(deck)
    if tags is not None:
        old = {t.lower(): t for t in n["tags"]}
        new = {t.lower(): t for t in (_tag(x) for x in tags if x.strip())}
        add = [t for k, t in new.items() if k not in old]
        remove = [t for k, t in old.items() if k not in new]
        for action, which in (("addTags", add), ("removeTags", remove)):
            if which:
                await engram.call("POST", "/api/cards/bulk",
                                  json={"ids": n["cardIds"], "action": action, "tags": " ".join(which)})
                changed = True
    return {"noteId": note_id, "changed": changed}


@mcp.tool()
async def delete_notes(note_ids: Annotated[list[int], Field(min_length=1)]) -> dict[str, Any]:
    """Delete notes and all their cards. Undo can bring the last change back."""
    for nid in note_ids:
        await engram.call("DELETE", f"/api/notes/{nid}")
    return {"deleted": note_ids}


@mcp.tool()
async def modify_cards(
    action: Annotated[
        Literal["move", "suspend", "unsuspend", "bury", "unbury", "addTags", "removeTags", "flag",
                "forget", "setDue", "delete"],
        Field(description="move needs deck; addTags/removeTags need tags; flag needs flag; "
                          "setDue needs days; forget resets to new; delete removes the whole notes."),
    ],
    note_ids: Annotated[list[int] | None, Field(description="Act on all cards of these notes")] = None,
    card_ids: list[int] | None = None,
    deck: str | None = None,
    tags: Annotated[str | None, Field(description="Space-separated tags")] = None,
    flag: Annotated[int | None, Field(description="0 none, 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple")] = None,
    days: Annotated[str | None, Field(description="Anki due syntax: '0' today, '1' tomorrow, '3-7' a range, '5!' also sets interval")] = None,
) -> dict[str, Any]:
    """Bulk actions on cards, exactly like selecting them in Engram's Browse view."""
    ids = await engram.card_ids(note_ids, card_ids)
    body: dict[str, Any] = {"ids": ids, "action": action}
    if action == "move":
        if not deck:
            raise EngramError("move needs a deck.")
        body["deckId"] = await engram.deck_id(deck, create=True)
    if tags is not None:
        body["tags"] = tags
    if flag is not None:
        body["flag"] = flag
    if days is not None:
        body["days"] = days
    res = await engram.call("POST", "/api/cards/bulk", json=body)
    return {"action": action, "cards": res.get("count", len(ids)), "undo": res.get("undo")}


@mcp.tool()
async def manage_deck(
    action: Literal["create", "rename", "delete", "get_options", "set_options"],
    deck: Annotated[str, Field(description="Full deck name (the new name, for create)")],
    new_name: Annotated[str | None, Field(description="rename: the new full name")] = None,
    new_per_day: int | None = None,
    reviews_per_day: int | None = None,
    desired_retention: Annotated[float | None, Field(ge=0.7, le=0.99)] = None,
) -> Any:
    """Create, rename or delete a deck (delete removes its cards), or read/change its daily
    limits and desired retention."""
    if action == "create":
        return await engram.call("POST", "/api/decks", json={"name": deck})
    did = await engram.deck_id(deck)
    if action == "rename":
        if not new_name:
            raise EngramError("rename needs new_name.")
        return await engram.call("PATCH", f"/api/decks/{did}", json={"name": new_name})
    if action == "delete":
        return await engram.call("DELETE", f"/api/decks/{did}")
    if action == "get_options":
        return await engram.call("GET", f"/api/decks/{did}/options")
    body = {k: v for k, v in (("newPerDay", new_per_day), ("reviewsPerDay", reviews_per_day),
                              ("desiredRetention", desired_retention)) if v is not None}
    return await engram.call("PUT", f"/api/decks/{did}/options", json=body)


@mcp.tool()
async def undo(do_it: Annotated[bool, Field(description="False: only report what undo would revert.")] = True) -> Any:
    """Undo the most recent change in Engram (one step), as the user's ⌘Z does."""
    if not do_it:
        return await engram.call("GET", "/api/undo")
    return await engram.call("POST", "/api/undo")


@mcp.tool()
async def add_image(
    filename: Annotated[str, Field(description="e.g. 'unit-circle.svg' or 'bayes-tree.png'")],
    data_base64: Annotated[str | None, Field(description="Image bytes, base64-encoded")] = None,
    svg: Annotated[str | None, Field(description="Alternatively, SVG source text")] = None,
    caption: str = "",
) -> dict[str, Any]:
    """Store an image in Engram and get the Markdown to put in a card field."""
    if svg:
        data, ctype = svg.encode(), "image/svg+xml"
        if not filename.lower().endswith(".svg"):
            filename += ".svg"
    elif data_base64:
        data = base64.b64decode(data_base64, validate=False)
        ext = filename.lower().rsplit(".", 1)[-1]
        ctype = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
                 "webp": "image/webp", "svg": "image/svg+xml"}.get(ext, "application/octet-stream")
    else:
        raise EngramError("Give either data_base64 or svg.")
    res = await engram.call("POST", "/api/media", files={"file": (filename, data, ctype)})
    return {"filename": res["filename"], "markdown": f"![{caption}]({res['filename']})"}


# ---------------------------------------------------------------- everything else


@mcp.tool()
async def engram_api_reference() -> str:
    """Every endpoint of Engram's REST API with its parameters and body fields, read live
    from Engram, so it stays current as Engram changes. Use with engram_api."""
    spec = await engram.call("GET", "/openapi.json")
    schemas = spec.get("components", {}).get("schemas", {})

    def fields(ref: str) -> str:
        s = schemas.get(ref.rsplit("/", 1)[-1], {})
        props = s.get("properties", {})
        req = set(s.get("required", []))
        return ", ".join(f"{k}{'' if k in req else '?'}" for k in props)

    lines = []
    for path, ops in spec.get("paths", {}).items():
        for method, op in ops.items():
            params = [p["name"] + ("" if p.get("required") else "?") for p in op.get("parameters", [])]
            body = op.get("requestBody", {}).get("content", {})
            schema = (body.get("application/json") or {}).get("schema", {})
            bdesc = f" body{{{fields(schema['$ref'])}}}" if "$ref" in schema else (" body: multipart file" if body else "")
            doc = (op.get("description") or op.get("summary") or "").strip().split("\n")[0]
            lines.append(f"{method.upper()} {path}" + (f" ({', '.join(params)})" if params else "") + bdesc
                         + (f" - {doc}" if doc else ""))
    return "\n".join(lines)


@mcp.tool()
async def engram_api(
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"],
    path: Annotated[str, Field(description="Starts with /api/, e.g. /api/review/123/next")],
    params: Annotated[dict[str, Any] | None, Field(description="Query parameters")] = None,
    body: Annotated[Any | None, Field(description="JSON body")] = None,
) -> Any:
    """Call any Engram API endpoint directly (see engram_api_reference). Covers everything
    the other tools don't: reviewing cards, statistics, settings, previews, notetypes."""
    if not path.startswith("/api/"):
        raise EngramError("path must start with /api/")
    kw: dict[str, Any] = {}
    if params:
        kw["params"] = params
    if body is not None:
        kw["json"] = body
    return await engram.call(method, path, **kw)


# ---------------------------------------------------------------- app


def create_app():
    if not PASSWORD_HASH:
        raise SystemExit("ENGRAM_MCP_PASSWORD_HASH is not set (python -m engram hash-password)")
    host = PUBLIC_URL.split("://", 1)[1]
    return mcp.streamable_http_app(
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[host, "127.0.0.1:*", "localhost:*"],
            allowed_origins=[PUBLIC_URL, "https://claude.ai", "https://claude.com"],
        ),
    )
