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

    @contextmanager
    def col(self) -> Iterator[Collection]:
        with self._lock:
            yield self._col

    def close(self) -> None:
        with self._lock:
            self._col.close()


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
