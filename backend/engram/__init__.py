"""Engram: a calmer, faster front end for Anki collections."""

__version__ = "0.1.0"

# anki.cards and anki.collection import each other; loading the collection
# module first is the order Anki itself relies on.
import anki.collection  # noqa: E402,F401
