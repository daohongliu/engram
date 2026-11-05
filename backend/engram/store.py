"""Owns the single open Anki collection.

The Rust backend behind ``anki.collection.Collection`` is not safe to use
from several threads at once, and FastAPI runs plain ``def`` endpoints in a
thread pool. Every access therefore goes through one re-entrant lock.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from anki.collection import Collection
from anki.errors import InvalidInput

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "collection.anki2"


class Store:
    def __init__(self, path: str | os.PathLike | None = None, seed_demo: bool | None = None):
        env_path = os.environ.get("ENGRAM_COLLECTION") or os.environ.get("BETTER_ANKI_COLLECTION")
        self.path = Path(path or env_path or DEFAULT_PATH).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        is_new = not self.path.exists()
        self._lock = threading.RLock()
        self._col = Collection(str(self.path))
        if is_new:
            # Fresh collections get the modern scheduler (FSRS). Existing
            # collections keep whatever the user chose in Anki.
            self._col.set_config("fsrs", True)
            if seed_demo is None:
                seed_demo = not (os.environ.get("ENGRAM_NO_DEMO") or os.environ.get("BETTER_ANKI_NO_DEMO"))
            if seed_demo:
                from .seed import seed_collection

                seed_collection(self._col)
        elif _has_unused_tags(self._col):
            # Tidy tags left behind before unused tags were removed automatically.
            self._col.tags.clear_unused_tags()

    @contextmanager
    def col(self) -> Iterator[Collection]:
        with self._lock:
            yield self._col

    def close(self) -> None:
        with self._lock:
            self._col.close()


def drop_unused_tags(col: Collection) -> None:
    """Delete tags that no note uses any more.

    Call this right after a change that may have removed the last use of a
    tag. The cleanup is folded into that change's undo step, so one undo
    brings back the notes and their tags together.
    """
    step = col.undo_status().last_step
    col.tags.clear_unused_tags()
    fold_into_step(col, step)


def fold_into_step(col: Collection, step: int) -> None:
    """Merge the undo entries added since ``step`` into the change before them.

    ``undo_status().last_step`` is a counter, not always an entry on the undo
    stack: Anki folds consecutive edits of the same note into one entry, and an
    undo moves the entry it reverts to the redo stack. In those cases the
    newest entry still on the stack has a lower number, so step back to it.
    If none is found nearby, the new entries simply stay separate undo steps.
    """
    if not step:
        return
    for target in range(step, max(0, step - 50), -1):
        try:
            col.merge_undo_entries(target)
            return
        except InvalidInput:
            continue


def _has_unused_tags(col: Collection) -> bool:
    used = {t.lower() for (s,) in col.db.all("select tags from notes where tags != ''") for t in s.split()}
    return any(
        t.lower() not in used and not any(u.startswith(t.lower() + "::") for u in used) for t in col.tags.all()
    )


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store()
    return _store


def set_store(store: Store | None) -> None:
    global _store
    _store = store


@contextmanager
def collection() -> Iterator[Collection]:
    with get_store().col() as col:
        yield col
