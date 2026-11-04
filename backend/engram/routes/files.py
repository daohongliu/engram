"""Media files, and the few settings we keep in the collection."""

from __future__ import annotations

import hashlib
import mimetypes
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..store import collection

router = APIRouter(prefix="/api", tags=["files"])

DEFAULT_PREAMBLE = r"""% KaTeX macros available on every card. One definition per line.
\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}
\newcommand{\Z}{\mathbb{Z}}
\newcommand{\Q}{\mathbb{Q}}
\newcommand{\C}{\mathbb{C}}
\newcommand{\eps}{\varepsilon}
\newcommand{\abs}[1]{\left|#1\right|}
\newcommand{\norm}[1]{\left\lVert#1\right\rVert}
"""


@router.get("/media/{name:path}")
def media(name: str) -> FileResponse:
    with collection() as col:
        root = Path(col.media.dir()).resolve()
    target = (root / name).resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(404, "No such file.")
    return FileResponse(target, headers={"Cache-Control": "max-age=86400"})


# Names browsers and operating systems give to pasted or captured images.
_GENERIC_NAME = re.compile(r"^(image|blob|pasted|clipboard|screenshot|screen shot|img|photo)\b", re.I)
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/avif"}
MAX_BYTES = 50 * 1024 * 1024


@router.post("/media")
async def upload_media(file: UploadFile) -> dict[str, Any]:
    data = await file.read()
    if not data:
        raise HTTPException(400, "That file is empty.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "That file is over 50 MB.")
    original = Path(file.filename or "")
    ext = original.suffix.lower() or mimetypes.guess_extension(file.content_type or "") or ".bin"
    ext = {".jpe": ".jpg", ".jpeg": ".jpg"}.get(ext, ext)
    if not original.stem or _GENERIC_NAME.match(original.stem):
        # Pasted screenshots all arrive as "image.png"; name them by content
        # instead, which also means pasting the same image twice stores it once.
        name = f"paste-{hashlib.sha1(data).hexdigest()[:16]}{ext}"
    else:
        stem = re.sub(r"[^\w\-]+", "-", original.stem).strip("-")[:80] or "file"
        name = f"{stem}{ext}"
    with collection() as col:
        stored = col.media.write_data(name, data)
    return {
        "filename": stored,
        "isImage": (file.content_type or "") in IMAGE_TYPES or ext in {".png", ".jpg", ".gif", ".webp", ".svg", ".avif"},
        "bytes": len(data),
    }


class SavedSearch(BaseModel):
    name: str
    query: str


class Settings(BaseModel):
    preamble: str | None = None
    savedSearches: list[SavedSearch] | None = None


DEFAULT_SAVED = [
    {"name": "Due today", "query": "is:due"},
    {"name": "Slipping away", "query": "is:fragile -is:suspended"},
    {"name": "Hard ones", "query": "is:hard"},
    {"name": "Written this week", "query": "added:7"},
]


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    with collection() as col:
        return {
            # Settings saved before the rename live under the old key.
            "preamble": col.get_config("engram.preamble", col.get_config("betterAnki.preamble", DEFAULT_PREAMBLE)),
            "collectionPath": col.path,
            "mediaPath": col.media.dir(),
            "fsrs": bool(col.get_config("fsrs", False)),
            "savedSearches": col.get_config("engram.savedSearches", DEFAULT_SAVED),
        }


@router.put("/settings")
def put_settings(body: Settings) -> dict[str, Any]:
    with collection() as col:
        if body.preamble is not None:
            col.set_config("engram.preamble", body.preamble)
        if body.savedSearches is not None:
            col.set_config(
                "engram.savedSearches", [s.model_dump() for s in body.savedSearches]
            )
    return get_settings()
