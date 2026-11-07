# Engram

Engram is a flashcard app. It uses the `anki` Python package for scheduling
and storage, and keeps cards in an ordinary Anki collection file. Card fields
are Markdown, and maths is written in LaTeX.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/study-dark.png">
  <img alt="Studying a card, with the cards still waiting listed on the right" src="docs/study-light.png">
</picture>

## Features

- Decks and subdecks, each with its own daily limits
- Studying one deck, several decks, or all decks together
- A list of upcoming cards next to the current card
- A rendered preview under each field while editing
- Cloze deletions, including inside maths
- Pasting and resizing images
- Searching, editing and bulk-editing cards, with undo
- Statistics
- LaTeX macros shared by all cards
- Light and dark themes
- Keyboard shortcuts, mostly the same as Anki's

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/browse-dark.png">
  <img alt="Browsing cards, with one open in the editor" src="docs/browse-light.png">
</picture>

## Running it

You need Python 3.10+ and Node 20+.

```sh
git clone https://github.com/daohongliu/engram.git
cd engram

python -m venv .venv
.venv/bin/pip install -e "backend[dev]"

cd frontend
npm install
npm run build        # builds into backend/engram/static
cd ..

.venv/bin/python -m engram          # http://127.0.0.1:8000
```

The first run creates a small demo collection (a few maths and computer
science decks). Delete the decks whenever you like, or start empty with
`ENGRAM_NO_DEMO=1`.

Everything is stored in `data/`: `collection.anki2` holds notes, cards and
review history, and `collection.media/` holds images. To back up, copy that
folder. `--collection path/to/collection.anki2` uses a different
location.

### Installing as an app

If you'd like it in its own window, with a Dock or taskbar icon, open
http://127.0.0.1:8000 while the server is running and:

- **Chrome or Edge:** click the install icon at the right of the address bar,
  or choose *Install Engram* from the menu.
- **Safari (macOS 14+):** choose *File › Add to Dock*.

The installed app still needs the server running in the background.

### Developing

```sh
.venv/bin/python -m engram --reload   # API on :8000
cd frontend && npm run dev                  # UI on :5173, proxies /api
```

Tests: `.venv/bin/python -m pytest backend` and `cd frontend && npm test`.

## Layout

```
backend/engram/
  fields.py       Markdown rendering (maths, image sizes) and field storage
  search.py       plain-text search and sidebar filters
  store.py        the single open collection, behind a lock
  seed.py         the demo collection
  routes/         decks, review, browse, notes, stats, media and settings
frontend/src/
  editor/         CodeMirror 6 field editor: source view, or live preview in place
  pages/          Decks, DeckOverview, Review, Add, Browse, Stats, Settings
  components/     card editor, card info, charts, command menu
  lib/            KaTeX rendering, API stores, keyboard handling
```

## License

MIT; see [LICENSE](LICENSE). Engram depends on the
[`anki`](https://pypi.org/project/anki/) package, which is licensed under the
AGPL-3.0, so its terms also apply when you distribute Engram together with it.
