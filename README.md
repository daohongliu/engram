# Engram

Engram is a flashcard app that uses the open-source `anki` Python package
underneath, so scheduling (including FSRS), note types and cloze deletions work
the same way they do in Anki. Fields are written in Markdown with LaTeX maths,
and images can be pasted straight in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/study-dark.png">
  <img alt="Studying a card, with the cards still waiting listed on the right" src="docs/study-light.png">
</picture>

## What it does

- Decks and subdecks with their own daily limits. You can study one deck,
  a few you pick, or all of them at once.
- While studying, the cards still to come are listed at the side, and you can
  jump to any of them. The keys are Anki's: space to show the answer, then 1–4.
- Fields are Markdown, with maths between `$` signs. A preview under each field
  shows how it will look. `⌘⇧C` makes a cloze deletion.
- Paste or drop images into a field, and drag a corner to resize them.
- Browsing shows each card as rendered text, question over answer. Search is
  plain words, with filters for decks, tags and card states in the sidebar.
  Changes to several cards at once can be undone with `⌘Z`.
- Statistics, LaTeX macros shared across cards, light and dark themes, a `⌘K`
  command menu, and `?` to list the keyboard shortcuts.

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
review history, and `collection.media/` holds images. Back up that folder to
back up everything. `--collection path/to/collection.anki2` uses a different
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
