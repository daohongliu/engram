from better_anki.search import _fold, visible_text


def test_fold_ignores_case_and_accents():
    assert _fold("Pólya ÉCOLE") == "polya ecole"


def test_visible_text_drops_markup_and_payload():
    text = visible_text('Hello <strong class="x">world</strong> \\(x^2 &lt; y\\)<!--⠿⠁⠿⠁⠁⠁⠁-->\x1fback')
    assert "strong" not in text and "class" not in text and "⠁" not in text
    assert "world" in text and "x^2 < y" in text and "back" in text


def search(client, **params):
    return client.get("/api/search", params=params).json()


def test_plain_words(client):
    r = search(client, text="spectral theorem")
    assert r["total"] == 3  # one cloze note, three cards
    assert search(client, text="SPECTRAL")["total"] == 3


def test_words_match_tags_and_decks(client):
    # "eigen" is only a tag; "probability" is a deck name
    assert search(client, text="eigen")["total"] >= 2
    assert search(client, text="probability")["total"] >= 3


def test_markup_does_not_match(client):
    assert search(client, text="strong")["total"] == 0
    assert search(client, text="class")["total"] == 0


def test_special_characters_are_literal(client):
    for text in ['deck:(', '"', "x_1", "*", "a:b", "(", "\\"]:
        r = search(client, text=text)
        assert "total" in r


def test_maths_source_is_searchable(client):
    assert search(client, text="\\sqrt")["total"] >= 1


def test_filters(client, deck_ids):
    algebra = search(client, deck="Maths::Linear Algebra")
    assert algebra["total"] >= 7
    assert search(client, deck="Maths")["total"] > algebra["total"]  # includes sub-decks
    assert search(client, tag="theorem", text="spectral")["total"] == 3
    assert search(client, state="new")["total"] == search(client)["total"]
    assert search(client, state="image")["total"] == 1
