# Engram

A flashcard app for the browser, built for cards with maths and images. It uses
the open-source `anki` Python package as its engine, so scheduling (FSRS), card
templates and clozes work as they do in Anki. The interface is new.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/study-dark.png">
  <img alt="Studying a card, with the cards still waiting listed on the right" src="docs/study-light.png">
</picture>

## Features

**Decks.** The deck list works like Anki's: new, learning and due counts per
deck, collapsible subdecks, and a menu for studying, adding, browsing,
renaming and deleting. Clicking a deck opens its overview, with a Study button
and the deck's daily limits and desired retention.

**Reviewing.** Study one deck, or press **Study all** to get cards from every
deck at once, mixed together and each deck keeping its own daily limits. The
card is centred, with the answer buttons and their next intervals in a bar at
the bottom. On the right, **Up next** lists the cards still waiting; click one
to study it now, and the card you skipped stays first in line. Edit, card
info, bury, suspend and flag are one click or one key away. The keys are
Anki's: space to show the answer, then 1–4.

**Adding cards.** Fields are Markdown with live preview. Type `$` and write
LaTeX; a preview appears under the expression as you type, and the source
collapses into rendered maths when the cursor leaves it. `⌘⇧C` makes a cloze
deletion. A preview of the resulting cards sits beside the form.

**Images.** Paste a screenshot into a field, drop image files in, or use
"Add image". Drag an image's corner in the editor to resize it; the width is
saved in the Markdown as `![caption|300](file.png)`. Click an image during
review to see it full size.

**Browsing.** Cards are listed as readable entries, question over answer,
with maths and images rendered and a menu to sort them. Clicking one opens an
editor pane that saves as you type. Search is plain text: type some words and you get the cards containing
all of them, ignoring case and accents, matched against card text, tags and
deck names. Filters for decks, tags and card states (due, new, suspended,
flagged, has image, and so on) are in the sidebar. Select several cards with
shift- or ⌘-click to move, tag, flag, suspend or delete them together; every
change can be undone with `⌘Z`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/browse-dark.png">
  <img alt="Browsing cards, with one open in the editor" src="docs/browse-light.png">
</picture>

**Also:** statistics (review heatmap, forecast, card counts, time of day),
LaTeX macros shared by every card, light and dark themes, a `⌘K` command
menu, and `?` for keyboard shortcuts.

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

Engram can be installed as an app with its own window and Dock or taskbar
icon. With the server running, open http://127.0.0.1:8000 and:

- **Chrome or Edge:** click the install icon at the right of the address bar,
  or choose *Install Engram* from the menu.
- **Safari (macOS 14+):** choose *File › Add to Dock*.

The app talks to the server on your machine, so start the server first
(`.venv/bin/python -m engram`) whenever you want to use it.

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
  editor/         CodeMirror 6 live preview for maths, formatting, clozes, images
  pages/          Decks, DeckOverview, Review, Add, Browse, Stats, Settings
  components/     card editor, card info, charts, command menu
  lib/            KaTeX rendering, API stores, keyboard handling
```

## License

MIT; see [LICENSE](LICENSE). Engram depends on the
[`anki`](https://pypi.org/project/anki/) package, which is licensed under the
AGPL-3.0, so its terms also apply when you distribute Engram together with it.
