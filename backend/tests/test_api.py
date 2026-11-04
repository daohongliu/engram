import io


def test_decks_tree(client, deck_ids):
    assert "Maths::Linear Algebra" in deck_ids
    data = client.get("/api/decks").json()
    assert data["totals"]["new"] > 0
    assert all(d["name"] != "Default" for d in data["decks"])


def test_review_cycle_and_undo(client, deck_ids):
    did = deck_ids["Maths::Probability"]
    first = client.get(f"/api/review/{did}/next").json()
    assert first["done"] is False
    assert len(first["intervals"]) == 4
    assert "<style" not in first["card"]["question"]
    before = first["counts"]["new"]

    r = client.post(f"/api/review/{did}/answer", json={"cardId": first["card"]["id"], "rating": 3, "ms": 4000})
    assert r.status_code == 200
    after = client.get(f"/api/review/{did}/next").json()
    assert after["counts"]["new"] == before - 1

    assert client.get("/api/undo").json()["undo"]
    client.post("/api/undo")
    again = client.get(f"/api/review/{did}/next").json()
    assert again["counts"]["new"] == before


def test_answer_for_wrong_card_is_refused(client, deck_ids):
    did = deck_ids["Maths::Probability"]
    r = client.post(f"/api/review/{did}/answer", json={"cardId": 1, "rating": 3})
    assert r.status_code == 409


def test_search_shorthands_and_errors(client):
    r = client.get("/api/search", params={"q": "@linear #eigen"}).json()
    assert r["ok"] and r["total"] >= 2
    assert r["query"] == "deck:*linear* tag:eigen"
    row = r["rows"][0]
    assert {"question", "answer", "due", "tags", "memory"} <= row.keys()

    bad = client.get("/api/search", params={"q": "deck:("}).json()
    assert bad["ok"] is False and "bracket" in bad["error"]

    for order in ("added", "due", "interval", "difficulty", "sortfield", "modified"):
        res = client.get("/api/search", params={"q": "", "order": order}).json()
        assert res["ok"], order


def test_pagination(client):
    a = client.get("/api/search", params={"q": "", "limit": 5}).json()
    b = client.get("/api/search", params={"q": "", "limit": 5, "offset": 5}).json()
    assert len(a["rows"]) == 5
    assert not {r["id"] for r in a["rows"]} & {r["id"] for r in b["rows"]}


def test_note_lifecycle(client, deck_ids):
    types = client.get("/api/notetypes").json()
    assert types[0]["name"] == "Basic"
    basic = types[0]
    did = deck_ids["Maths::Analysis"]

    created = client.post(
        "/api/notes",
        json={"notetypeId": basic["id"], "deckId": did, "fields": ["What is $\\lim_{n\\to\\infty} 1/n$?", "$0$"], "tags": ["limits"]},
    ).json()
    nid = created["noteId"]
    note = client.get(f"/api/notes/{nid}").json()
    assert note["fields"][0]["source"] == "What is $\\lim_{n\\to\\infty} 1/n$?"
    assert note["tags"] == ["limits"]

    found = client.get("/api/search", params={"q": "#limits"}).json()
    assert found["total"] == 1
    assert "\\(\\lim" in found["rows"][0]["question"]

    client.put(f"/api/notes/{nid}", json={"fields": ["Changed", "$0$"], "tags": ["limits", "edited"]})
    note = client.get(f"/api/notes/{nid}").json()
    assert note["fields"][0]["source"] == "Changed"
    assert sorted(note["tags"]) == ["edited", "limits"]

    client.delete(f"/api/notes/{nid}")
    assert client.get(f"/api/notes/{nid}").status_code == 404


def test_add_rejects_empty_and_bad_cloze(client, deck_ids):
    types = {t["name"]: t for t in client.get("/api/notetypes").json()}
    did = deck_ids["Maths"]
    r = client.post("/api/notes", json={"notetypeId": types["Basic"]["id"], "deckId": did, "fields": ["", "x"]})
    assert r.status_code == 400
    r = client.post("/api/notes", json={"notetypeId": types["Cloze"]["id"], "deckId": did, "fields": ["no deletions", ""]})
    assert r.status_code == 400 and "deletion" in r.json()["detail"]


def test_preview_cloze(client):
    types = {t["name"]: t for t in client.get("/api/notetypes").json()}
    r = client.post(
        "/api/notes/preview",
        json={"notetypeId": types["Cloze"]["id"], "fields": ["{{c1::Paris}} is in {{c2::France}}", ""]},
    ).json()
    assert [c["label"] for c in r["cards"]] == ["Cloze 1", "Cloze 2"]
    assert "[...]" in r["cards"][0]["question"]
    assert "Paris" in r["cards"][0]["answer"]


def test_preview_skips_empty_optional_cards(client):
    types = {t["name"]: t for t in client.get("/api/notetypes").json()}
    opt = types["Basic (optional reversed card)"]
    r = client.post("/api/notes/preview", json={"notetypeId": opt["id"], "fields": ["front", "back", ""]}).json()
    assert len(r["cards"]) == 1


def test_bulk_actions(client):
    rows = client.get("/api/search", params={"q": "#theorem"}).json()["rows"]
    ids = [r["id"] for r in rows[:2]]
    client.post("/api/cards/bulk", json={"ids": ids, "action": "suspend"})
    assert client.get("/api/search", params={"q": "is:suspended"}).json()["total"] == 2
    client.post("/api/cards/bulk", json={"ids": ids, "action": "addTags", "tags": "bulk"})
    assert client.get("/api/search", params={"q": "#bulk"}).json()["total"] >= 2
    client.post("/api/cards/bulk", json={"ids": ids, "action": "flag", "flag": 2})
    assert client.get("/api/search", params={"q": "flag:2"}).json()["total"] == 2
    client.post("/api/undo")
    assert client.get("/api/search", params={"q": "flag:2"}).json()["total"] == 0


def test_card_detail(client):
    cid = client.get("/api/search", params={"q": "rank"}).json()["rows"][0]["id"]
    d = client.get(f"/api/cards/{cid}").json()
    assert d["fields"][0]["kind"] == "md"
    assert "rank" in d["fields"][0]["source"]
    assert d["notetype"]["name"] == "Basic"


def test_stats(client):
    s = client.get("/api/stats").json()
    assert len(s["calendar"]) == 371
    assert len(s["forecast"]) == 31
    assert s["totalNotes"] > 10
    assert len(s["hours"]) == 24


def test_settings_round_trip(client):
    s = client.get("/api/settings").json()
    assert "\\newcommand{\\R}" in s["preamble"]
    client.put("/api/settings", json={"preamble": "\\newcommand{\\F}{\\mathbb{F}}", "savedSearches": [{"name": "x", "query": "is:new"}]})
    s = client.get("/api/settings").json()
    assert s["preamble"] == "\\newcommand{\\F}{\\mathbb{F}}"
    assert s["savedSearches"] == [{"name": "x", "query": "is:new"}]


def test_media_upload_and_traversal(client):
    r = client.post("/api/media", files={"file": ("dot.png", io.BytesIO(b"\x89PNG fake"), "image/png")}).json()
    assert client.get(f"/api/media/{r['filename']}").content == b"\x89PNG fake"
    assert client.get("/api/media/..%2F..%2Fcollection.anki2").status_code == 404


def test_pasted_images_are_named_by_content(client):
    png = b"\x89PNG\r\n\x1a\n" + b"pixels" * 10
    a = client.post("/api/media", files={"file": ("image.png", io.BytesIO(png), "image/png")}).json()
    b = client.post("/api/media", files={"file": ("image.png", io.BytesIO(png), "image/png")}).json()
    assert a["filename"].startswith("paste-") and a["filename"].endswith(".png")
    assert a["filename"] == b["filename"]  # same picture, stored once
    assert a["isImage"]
    named = client.post("/api/media", files={"file": ("Krebs cycle (v2).JPEG", io.BytesIO(b"jpg"), "image/jpeg")}).json()
    assert named["filename"].lower() == "krebs-cycle-v2.jpg"
    assert client.post("/api/media", files={"file": ("x.png", io.BytesIO(b""), "image/png")}).status_code == 400


def test_image_cards(client, deck_ids):
    basic = client.get("/api/notetypes").json()[0]
    png = b"\x89PNG\r\n\x1a\n" + b"diagram"
    name = client.post("/api/media", files={"file": ("image.png", io.BytesIO(png), "image/png")}).json()["filename"]
    # A card whose front is only an image is allowed.
    created = client.post(
        "/api/notes",
        json={"notetypeId": basic["id"], "deckId": deck_ids["Maths"], "fields": [f"![Name this graph|320]({name})", "$K_{3,3}$"]},
    )
    assert created.status_code == 200
    cid = created.json()["cardIds"][0]
    detail = client.get(f"/api/cards/{cid}").json()
    assert f'<img src="{name}" width="320" alt="Name this graph">' in detail["question"]
    assert client.get(f"/api/media/{name}").content == png


def test_deck_crud_and_options(client):
    r = client.post("/api/decks", json={"name": "Topology::Point-set"}).json()
    did = r["id"]
    assert client.post("/api/decks", json={"name": "Topology::Point-set"}).status_code == 409
    client.patch(f"/api/decks/{did}", json={"name": "Topology::General"})
    names = client.get("/api/search/vocab").json()["decks"]
    assert "Topology::General" in names
    opts = client.put(f"/api/decks/{did}/options", json={"newPerDay": 7, "desiredRetention": 0.88}).json()
    assert opts["newPerDay"] == 7 and abs(opts["desiredRetention"] - 0.88) < 1e-6


def test_spa_fallback(client):
    assert client.get("/api/nope").status_code == 404
