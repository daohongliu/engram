import pytest
from fastapi.testclient import TestClient

from better_anki.app import create_app
from better_anki.store import Store, set_store


@pytest.fixture()
def client(tmp_path):
    store = Store(tmp_path / "collection.anki2", seed_demo=True)
    set_store(store)
    with TestClient(create_app()) as c:
        yield c
    set_store(None)


@pytest.fixture()
def deck_ids(client):
    def walk(nodes):
        for n in nodes:
            yield n["fullName"], n["id"]
            yield from walk(n["children"])

    return dict(walk(client.get("/api/decks").json()["decks"]))
