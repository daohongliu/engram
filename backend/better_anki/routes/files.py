"""Media, import/export and the few settings we keep in the collection."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any

from anki.collection import (
    DeckIdLimit,
    ExportAnkiPackageOptions,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
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


@router.post("/media")
async def upload_media(file: UploadFile) -> dict[str, Any]:
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "That file is over 50 MB.")
    name = re.sub(r"[^\w.\-]+", "-", file.filename or "pasted") or "pasted"
    with collection() as col:
        stored = col.media.write_data(name, data)
    return {"filename": stored}


@router.post("/import")
async def import_package(file: UploadFile) -> dict[str, Any]:
    suffix = Path(file.filename or "deck.apkg").suffix.lower()
    if suffix not in (".apkg", ".colpkg"):
        raise HTTPException(400, "Import takes .apkg files exported from Anki.")
    if suffix == ".colpkg":
        raise HTTPException(
            400,
            "A .colpkg replaces a whole collection. Point BETTER_ANKI_COLLECTION at your "
            "collection.anki2 instead, or export decks as .apkg.",
        )
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        with collection() as col:
            out = col.import_anki_package(
                ImportAnkiPackageRequest(
                    package_path=path,
                    options=ImportAnkiPackageOptions(
                        with_scheduling=True, with_deck_configs=True
                    ),
                )
            )
        log = out.log
        return {
            "new": len(log.new),
            "updated": len(log.updated),
            "duplicate": len(log.duplicate),
            "conflicting": len(log.conflicting),
            "total": log.found_notes,
        }
    finally:
        os.unlink(path)


@router.get("/export/{deck_id}")
def export_deck(deck_id: int, background: BackgroundTasks, scheduling: bool = True) -> FileResponse:
    with collection() as col:
        name = col.decks.name(deck_id)
        fd, path = tempfile.mkstemp(suffix=".apkg")
        os.close(fd)
        col.export_anki_package(
            out_path=path,
            options=ExportAnkiPackageOptions(
                with_scheduling=scheduling,
                with_deck_configs=scheduling,
                with_media=True,
                legacy=False,
            ),
            limit=DeckIdLimit(deck_id),
        )
    background.add_task(os.unlink, path)
    safe = re.sub(r"[^\w\-]+", "-", name).strip("-") or "deck"
    return FileResponse(path, filename=f"{safe}.apkg", media_type="application/octet-stream")


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
            "preamble": col.get_config("betterAnki.preamble", DEFAULT_PREAMBLE),
            "collectionPath": col.path,
            "fsrs": bool(col.get_config("fsrs", False)),
            "savedSearches": col.get_config("betterAnki.savedSearches", DEFAULT_SAVED),
        }


@router.put("/settings")
def put_settings(body: Settings) -> dict[str, Any]:
    with collection() as col:
        if body.preamble is not None:
            col.set_config("betterAnki.preamble", body.preamble)
        if body.savedSearches is not None:
            col.set_config(
                "betterAnki.savedSearches", [s.model_dump() for s in body.savedSearches]
            )
    return get_settings()
