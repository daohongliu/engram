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


def test_search_rows(client):
    r = client.get("/api/search", params={"text": "eigen"}).json()
    assert r["total"] >= 2
    row = r["rows"][0]
    assert {"question", "answer", "due", "tags", "memory"} <= row.keys()
    for order in ("added", "due", "interval", "difficulty", "sortfield", "modified"):
        res = client.get("/api/search", params={"order": order}).json()
        assert res["total"] > 0, order


def test_pagination(client):
    a = client.get("/api/search", params={"limit": 5}).json()
    b = client.get("/api/search", params={"limit": 5, "offset": 5}).json()
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

    found = client.get("/api/search", params={"tag": "limits"}).json()
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
    rows = client.get("/api/search", params={"tag": "theorem"}).json()["rows"]
    ids = [r["id"] for r in rows[:2]]
    client.post("/api/cards/bulk", json={"ids": ids, "action": "suspend"})
    assert client.get("/api/search", params={"state": "suspended"}).json()["total"] == 2
    client.post("/api/cards/bulk", json={"ids": ids, "action": "addTags", "tags": "bulk"})
    assert client.get("/api/search", params={"tag": "bulk"}).json()["total"] >= 2
    client.post("/api/cards/bulk", json={"ids": ids, "action": "flag", "flag": 2})
    assert client.get("/api/search", params={"state": "flagged"}).json()["total"] == 2
    client.post("/api/undo")
    assert client.get("/api/search", params={"state": "flagged"}).json()["total"] == 0


def test_card_detail(client):
    cid = client.get("/api/search", params={"text": "rank nullity"}).json()["rows"][0]["id"]
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
    def names(nodes):
        for n in nodes:
            yield n["fullName"]
            yield from names(n["children"])

    assert "Topology::General" in set(names(client.get("/api/decks").json()["decks"]))
    opts = client.put(f"/api/decks/{did}/options", json={"newPerDay": 7, "desiredRetention": 0.88}).json()
    assert opts["newPerDay"] == 7 and abs(opts["desiredRetention"] - 0.88) < 1e-6


def test_spa_fallback(client):
    assert client.get("/api/nope").status_code == 404


def test_tags_endpoint(client):
    tags = {t["name"]: t["notes"] for t in client.get("/api/tags").json()}
    assert tags["theorem"] >= 3


def test_unused_tags_are_deleted(client, deck_ids):
    def tag_names():
        return {t["name"] for t in client.get("/api/tags").json()}

    basic = client.get("/api/notetypes").json()[0]
    did = deck_ids["Maths::Analysis"]
    nid = client.post(
        "/api/notes", json={"notetypeId": basic["id"], "deckId": did, "fields": ["Q", "A"], "tags": ["draft"]}
    ).json()["noteId"]
    assert "draft" in tag_names()

    # Retagging the only note that used a tag deletes the old tag.
    client.put(f"/api/notes/{nid}", json={"fields": ["Q", "A"], "tags": ["final"]})
    assert "draft" not in tag_names()
    assert "final" in tag_names()

    # Deleting the last note with a tag deletes the tag, and one undo restores both.
    client.delete(f"/api/notes/{nid}")
    assert "final" not in tag_names()
    assert client.post("/api/undo").json()["undid"] == "Delete Note"
    assert client.get(f"/api/notes/{nid}").status_code == 200
    assert "final" in tag_names()

    # Removing a tag in bulk from every note that has it deletes it.
    cids = [r["id"] for r in client.get("/api/search", params={"tag": "final"}).json()["rows"]]
    client.post("/api/cards/bulk", json={"ids": cids, "action": "removeTags", "tags": "final"})
    assert "final" not in tag_names()

    # Tags still in use elsewhere are kept.
    assert "theorem" in tag_names()


def test_unused_tags_are_tidied_on_open(tmp_path):
    from engram.store import Store

    path = tmp_path / "collection.anki2"
    store = Store(path, seed_demo=False)
    with store.col() as col:
        note = col.new_note(col.models.by_name("Basic"))
        note["Front"] = "Q"
        note.tags = ["orphan"]
        col.add_note(note, 1)
        col.remove_notes([note.id])  # bypasses the cleanup, leaving the tag behind
        assert "orphan" in col.tags.all()
    store.close()

    store = Store(path, seed_demo=False)
    with store.col() as col:
        assert "orphan" not in col.tags.all()
    store.close()


def test_study_all_decks(client, deck_ids):
    first = client.get("/api/review/0/next").json()
    assert first["done"] is False
    assert first["deckName"] == "All decks"
    totals = client.get("/api/decks").json()["totals"]
    assert first["counts"] == {"new": totals["new"], "learn": totals["learn"], "review": totals["review"]}

    # Cards come from more than one deck, and the current card is not listed as upcoming.
    upcoming = first["upcoming"]
    assert upcoming and first["card"]["id"] not in {u["id"] for u in upcoming}
    roots = {d.split("::")[0] for d in [first["card"]["deck"], *(u["deck"] for u in upcoming)]}
    assert len(roots) > 1

    r = client.post("/api/review/0/answer", json={"cardId": first["card"]["id"], "rating": 3})
    assert r.status_code == 200
    after = client.get("/api/review/0/next").json()
    assert after["counts"]["new"] == first["counts"]["new"] - 1


def test_study_chosen_decks(client, deck_ids):
    prob, algo = deck_ids["Maths::Probability"], deck_ids["Computer Science::Algorithms"]
    first = client.get(f"/api/review/{prob},{algo}/next").json()
    assert first["done"] is False
    assert first["deckName"] == "Probability, Algorithms"
    decks = {first["card"]["deck"], *(u["deck"] for u in first["upcoming"])}
    assert decks == {"Maths::Probability", "Computer Science::Algorithms"}

    one = lambda did: client.get(f"/api/review/{did}/next").json()["counts"]  # noqa: E731
    a, b = one(prob), one(algo)
    assert first["counts"] == {k: a[k] + b[k] for k in a}

    r = client.post(f"/api/review/{prob},{algo}/answer", json={"cardId": first["card"]["id"], "rating": 3})
    assert r.status_code == 200


def test_study_chosen_decks_inside_each_other(client, deck_ids):
    # A deck chosen along with its parent is already part of it.
    maths, prob = deck_ids["Maths"], deck_ids["Maths::Probability"]
    both = client.get(f"/api/review/{maths},{prob}/next").json()
    alone = client.get(f"/api/review/{maths}/next").json()
    assert both["counts"] == alone["counts"]
    assert both["deckName"] == "Maths"


def test_study_unknown_decks(client, deck_ids):
    assert client.get("/api/review/1,999999/next").status_code == 404
    assert client.get("/api/review/abc/next").status_code == 404


def test_jump_ahead_to_an_upcoming_card(client, deck_ids):
    did = deck_ids["Maths::Probability"]
    first = client.get(f"/api/review/{did}/next").json()
    assert first["upcoming"]
    target = first["upcoming"][-1]["id"]

    shown = client.get(f"/api/review/{did}/next", params={"cardId": target}).json()
    assert shown["card"]["id"] == target
    assert first["card"]["id"] in {u["id"] for u in shown["upcoming"]}

    r = client.post(f"/api/review/{did}/answer", json={"cardId": target, "rating": 3})
    assert r.status_code == 200
    after = client.get(f"/api/review/{did}/next").json()
    assert after["counts"]["new"] == first["counts"]["new"] - 1
    # The skipped card is still first in line.
    assert after["card"]["id"] == first["card"]["id"]

    # One undo takes the answer back.
    assert client.post("/api/undo").json()["undid"] == "Answer Card"
    again = client.get(f"/api/review/{did}/next").json()
    assert again["counts"]["new"] == first["counts"]["new"]
    assert target in {again["card"]["id"], *(u["id"] for u in again["upcoming"])}


def test_studying_does_not_add_undo_steps(client, deck_ids):
    did = deck_ids["Maths::Probability"]
    client.get("/api/review/0/next")
    client.get(f"/api/review/{did}/next")
    client.get("/api/review/0/next")
    assert client.get("/api/undo").json()["undo"] != "Select Deck"


def test_browse_notes_mode(client):
    cards = client.get("/api/search", params={"text": "spectral theorem"}).json()
    notes = client.get("/api/search", params={"text": "spectral theorem", "notes": True}).json()
    # The spectral theorem is one cloze note with three cards.
    assert cards["total"] == 3
    assert notes["total"] == 1
    row = notes["rows"][0]
    assert sorted(row["cardIds"]) == sorted(r["id"] for r in cards["rows"])
    assert row["id"] in row["cardIds"]
    # Every deletion is shown and highlighted, with no cloze syntax left.
    assert row["question"].count('class="cloze"') == 3
    assert "{{c" not in row["question"]

    # Looking a note up by one of its cards keeps that card as the entry's id.
    other = [c for c in row["cardIds"] if c != row["id"]][0]
    again = client.get("/api/search", params={"cid": other, "notes": True}).json()
    assert again["total"] == 1 and again["rows"][0]["id"] == other

    # Notes view never has more entries than cards view.
    all_cards = client.get("/api/search").json()["total"]
    all_notes = client.get("/api/search", params={"notes": True}).json()["total"]
    assert 0 < all_notes < all_cards


def test_notes_mode_cloze_inside_maths(client):
    rows = client.get("/api/search", params={"text": "Poisson", "notes": True}).json()["rows"]
    assert len(rows) == 1
    q = rows[0]["question"]
    assert "{{c" not in q
    # No HTML inside a formula, where it would break the maths; the deletion
    # is coloured with \htmlClass instead.
    maths = __import__("re").findall(r"\\\(.*?\\\)", q)
    assert all("<span" not in m for m in maths)
    assert any("\\htmlClass{cloze}{" in m for m in maths)


def test_cloze_around_maths_is_shown():
    from engram.routes.browse import _field_html

    # A deletion wrapping a whole formula, with "}}" inside the TeX.
    html = _field_html(r"Then {{c1::\[\frac{1}{x^{2}}\]}} with {{c2::text \(y\)}}.")
    assert "{{c" not in html and "}}." not in html
    assert r"\[\htmlClass{cloze}{\frac{1}{x^{2}}}\]" in html
    assert '<span class="cloze">text </span>' in html
    assert r"\(\htmlClass{cloze}{y}\)" in html


def test_retagging_right_after_an_edit(client, deck_ids):
    # Anki folds consecutive edits of one note into a single undo step, so the
    # step number read after the second edit is not on the undo stack. Folding
    # the tag clean-up into it used to fail with "target undo op not found".
    basic = client.get("/api/notetypes").json()[0]
    did = deck_ids["Maths::Analysis"]
    nid = client.post(
        "/api/notes", json={"notetypeId": basic["id"], "deckId": did, "fields": ["Q", "A"], "tags": ["draft"]}
    ).json()["noteId"]
    assert client.put(f"/api/notes/{nid}", json={"fields": ["Q", "A2"], "tags": ["draft"]}).status_code == 200
    # Adding a tag that already exists elsewhere: nothing becomes unused.
    r = client.put(f"/api/notes/{nid}", json={"fields": ["Q", "A2"], "tags": ["draft", "theorem"]})
    assert r.status_code == 200
    # Replacing a tag: "draft" becomes unused and is cleared.
    r = client.put(f"/api/notes/{nid}", json={"fields": ["Q", "A3"], "tags": ["final"]})
    assert r.status_code == 200
    assert "draft" not in {t["name"] for t in client.get("/api/tags").json()}
    # Undo still restores the note together with its old tag.
    client.post("/api/undo")
    note = client.get(f"/api/notes/{nid}").json()
    assert "draft" in note["tags"]
    assert "draft" in {t["name"] for t in client.get("/api/tags").json()}


def test_studying_another_deck_after_undo(client, deck_ids):
    # After an undo, the last step number belongs to the undone change, which
    # is no longer on the undo stack; selecting a deck used to fold into it
    # and fail with "target undo op not found".
    first, second = deck_ids["Maths::Analysis"], deck_ids["Maths::Probability"]
    assert client.get(f"/api/review/{first}/next").status_code == 200
    cid = client.get("/api/search", params={"deck": "Maths::Analysis"}).json()["rows"][0]["id"]
    client.post("/api/cards/bulk", json={"ids": [cid], "action": "suspend"})
    assert client.post("/api/undo").json()["undid"] == "Suspend"
    assert client.get(f"/api/review/{second}/next").status_code == 200
    assert client.get("/api/undo").json()["undo"] != "Select Deck"


def test_removing_a_cloze_deletes_its_card(client, deck_ids):
    types = {t["name"]: t for t in client.get("/api/notetypes").json()}
    did = next(iter(deck_ids.values()))
    created = client.post(
        "/api/notes",
        json={"notetypeId": types["Cloze"]["id"], "deckId": did,
              "fields": ["{{c1::Paris}} is in {{c2::France}} in {{c3::Europe}}", ""]},
    ).json()
    nid = created["noteId"]
    assert len(created["cardIds"]) == 3

    # Drop c2: its card goes, the other two stay.
    r = client.put(f"/api/notes/{nid}", json={"fields": ["{{c1::Paris}} is in France in {{c3::Europe}}", ""]}).json()
    assert len(r["removedCardIds"]) == 1
    after = client.get(f"/api/notes/{nid}").json()["cardIds"]
    assert len(after) == 2 and set(after) == set(created["cardIds"]) - set(r["removedCardIds"])
    for cid in after:
        assert "No cloze" not in client.get(f"/api/cards/{cid}").json()["question"]

    # Re-adding c2 makes a fresh, new card rather than reviving the old schedule.
    r = client.put(f"/api/notes/{nid}", json={"fields": ["{{c1::Paris}} is in {{c2::France}} in {{c3::Europe}}", ""]}).json()
    assert r["removedCardIds"] == []
    assert len(client.get(f"/api/notes/{nid}").json()["cardIds"]) == 3

    # One undo restores the text and the deleted card together.
    client.put(f"/api/notes/{nid}", json={"fields": ["{{c1::Paris}} is in {{c2::France}} in Europe", ""]})
    assert len(client.get(f"/api/notes/{nid}").json()["cardIds"]) == 2
    client.post("/api/undo")
    note = client.get(f"/api/notes/{nid}").json()
    assert len(note["cardIds"]) == 3
    assert "{{c3::Europe}}" in note["fields"][0]["source"]

    # With no deletions left at all, the note keeps its cards.
    r = client.put(f"/api/notes/{nid}", json={"fields": ["Paris is in France", ""]}).json()
    assert r["removedCardIds"] == []
    assert len(client.get(f"/api/notes/{nid}").json()["cardIds"]) == 3


def test_change_notetype_keeps_the_schedule(client, deck_ids):
    types = {t["name"]: t for t in client.get("/api/notetypes").json()}
    did = deck_ids["Maths::Analysis"]
    r = client.post("/api/notes", json={"notetypeId": types["Basic"]["id"], "deckId": did,
                                        "fields": ["Q", "A"], "tags": []}).json()
    nid, (cid,) = r["noteId"], r["cardIds"]
    client.post("/api/cards/bulk", json={"ids": [cid], "action": "setDue", "days": "5!"})
    due = client.get(f"/api/cards/{cid}").json()["due"]

    # Write the deletions, then make it a cloze note: the card becomes c1, c2 is new.
    client.put(f"/api/notes/{nid}", json={"fields": ["$x = {{c1::1}}$ and {{c2::two}}", "A"], "tags": []})
    res = client.post(f"/api/notes/{nid}/notetype", json={"notetypeId": types["Cloze"]["id"]}).json()
    assert res["notetype"]["isCloze"] and res["removedCardIds"] == [] and len(res["addedCardIds"]) == 1
    assert cid in res["cardIds"]
    assert client.get(f"/api/cards/{cid}").json()["due"] == due
    note = client.get(f"/api/notes/{nid}").json()
    assert [f["name"] for f in note["fields"]] == ["Text", "Back Extra"]
    assert note["fields"][0]["source"].startswith("$x = {{c1::1}}$")

    # Undo puts the Basic note back.
    client.post("/api/undo")
    assert client.get(f"/api/notes/{nid}").json()["notetype"]["name"] == "Basic"

    # Back to Basic from cloze: only c1's card can stay.
    client.post(f"/api/notes/{nid}/notetype", json={"notetypeId": types["Cloze"]["id"]})
    res = client.post(f"/api/notes/{nid}/notetype", json={"notetypeId": types["Basic"]["id"]}).json()
    assert res["cardIds"] == [cid] and len(res["removedCardIds"]) == 1
    assert client.post(f"/api/notes/{nid}/notetype", json={"notetypeId": 1}).status_code == 404


def test_redo_after_undo(client, deck_ids):
    basic = client.get("/api/notetypes").json()[0]
    nid = client.post("/api/notes", json={"notetypeId": basic["id"], "deckId": deck_ids["Maths"],
                                          "fields": ["Redo me", "A"], "tags": []}).json()["noteId"]
    assert client.post("/api/redo").status_code == 409
    client.delete(f"/api/notes/{nid}")
    client.post("/api/undo")
    assert client.get(f"/api/notes/{nid}").status_code == 200
    assert client.get("/api/undo").json()["redo"]
    r = client.post("/api/redo")
    assert r.status_code == 200 and r.json()["redid"]
    assert client.get(f"/api/notes/{nid}").status_code == 404


def test_cloze_inside_maths_is_coloured_while_studying(client):
    cloze = next(t for t in client.get("/api/notetypes").json() if t["name"] == "Cloze")
    did = client.post("/api/decks", json={"name": "Maths clozes"}).json()["id"]
    text = r"For {{c1::$|x| < 1$}}, $(1+x)^\alpha = {{c1::\sum_k x^k}}$ and $a{{c2::b::hint}}$"
    client.post("/api/notes", json={"notetypeId": cloze["id"], "deckId": did, "fields": [text, ""], "tags": []})

    card = client.get(f"/api/review/{did}/next").json()["card"]
    assert r"\((1+x)^\alpha = \htmlClass{cloze}{[...]}\)" in card["question"]
    assert r"\htmlClass{cloze}{\sum_k x^k}" in card["answer"]
    # The other card's deletion stays plain on this card.
    assert r"\(ab\)" in card["answer"] and "hint" not in card["question"]

    other = next(c for c in client.get("/api/search", params={"text": "hint"}).json()["rows"]
                 if c["id"] != card["id"])
    card2 = client.get(f"/api/review/{did}/next", params={"cardId": other["id"]}).json()["card"]
    assert r"\(a\htmlClass{cloze}{[hint]}\)" in card2["question"]
