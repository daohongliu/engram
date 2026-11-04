# Better Anki

A calmer, faster flashcard app in the browser, for maths-heavy and picture-heavy
cards. Underneath it uses the open-source `anki` Python package as its engine, so
it gets Anki's scheduler (FSRS), card templates, clozes and search language for
free. Everything you look at and type into is new.

![The contents page](docs/contents.png)

## What it does

**Writing cards.** Fields are Markdown with live preview, in the manner of
Obsidian. Type `$` and the editor pairs it; as you write LaTeX a small preview
floats under the expression and re-typesets on every keystroke. Move the cursor
away and the source collapses into rendered maths; click it to get the source
back. Bold, italics, headings, links, images and cloze deletions behave the same
way. `⌘⇧C` wraps a selection in the next cloze number.

**Images.** Paste a screenshot into any field and it goes onto the card; you can
also drop image files in, or use **+ image** above a field (the only option on a
phone or tablet). While it uploads, a placeholder holds its place. The picture
shows in the editor straight away; drag its corner to resize it, which records
the width in the Markdown as `![caption|300](paste-….png)`, Obsidian's syntax.
During review, click a picture to see it full size. In the browser, cards show
thumbnails, and `has:image` (or the "With an image" filter) finds every card
with a picture. Pasted images are named by their content, so pasting the same
screenshot twice stores it once.

![Writing a card: the maths preview follows the cursor](docs/write.png)

**Margin notes.** Markdown footnotes (`[^1]`) are lifted out of the card during
review and set in the right-hand margin beside the line that cites them, so
asides and proof sketches stay out of the answer until you want them.

**Browsing.** The browser is a single page with three columns: filters on the
left, the cards themselves (rendered, with maths) in the middle, and the selected
card open for editing on the right. Edits save themselves. Search is instant
(results update as you type, usually in a few milliseconds), autocompletes tags,
decks and keywords, and reads your query back as an English sentence whose
clauses you can click to negate or remove. Anki's full search language still
works, plus a few shorthands:

| You type          | Anki sees                  |
|-------------------|----------------------------|
| `#calculus`       | `tag:calculus`             |
| `@analysis`       | `deck:*analysis*`          |
| `is:due`          | `is:due` (unchanged)       |
| `is:fragile`      | `prop:r<0.8` (likely to be forgotten) |
| `is:hard`         | `prop:d>0.7`               |
| `has:image`       | cards containing a picture |

`j`/`k` move through results, `x` selects, shift-click selects a range, and a bar
appears for bulk moves, tags, flags, suspension and deletion. Nothing asks for
confirmation; everything can be undone with `⌘Z` or the button on the toast.

![The browser, with a card open for editing](docs/browse.png)

**Reviewing.** One card, set in a book face, with a hand-drawn rule between
question and answer. The left margin shows where you are and, once you reveal the
answer, what the scheduler thinks of the card (recall odds, stability,
difficulty). Keys are Anki's: space, then 1–4.

![Reviewing: footnotes become margin notes](docs/review.png)

**Everything else.** A command palette on `⌘K`, a contents page laid out like the
front of a book, an almanac of statistics, a LaTeX preamble for your own macros
(`\R`, `\norm{x}` and friends come predefined), light and dark themes, and `?`
for the list of shortcuts.

## Where things are kept

Everything lives in one folder: `data/collection.anki2` (an Anki-format SQLite
database holding notes, cards and review history) and `data/collection.media/`
(your images). Back up `data/` and you have backed up everything. Fields are
stored as rendered HTML with the Markdown source alongside, so the Markdown you
typed is always what you get back in the editor.

## Running it

You need Python 3.10+ and Node 20+.

```sh
python -m venv .venv
.venv/bin/pip install -e "backend[dev]"

cd frontend
npm install
npm run build        # builds into backend/better_anki/static
cd ..

.venv/bin/python -m better_anki          # http://127.0.0.1:8000
```

On first run this creates `data/collection.anki2` with a small demo collection:
a "Start here" deck that explains the app, and some linear algebra, analysis,
probability and algorithms cards.

Delete the demo decks whenever you like (each deck's ⋯ menu), or start empty
with `BETTER_ANKI_NO_DEMO=1`. To keep a collection somewhere else, pass
`--collection path/to/collection.anki2`.

### Developing

```sh
.venv/bin/python -m better_anki --reload   # API on :8000
cd frontend && npm run dev                  # UI on :5173, proxies /api
```

Tests: `.venv/bin/python -m pytest backend` and `cd frontend && npm test`.

## Layout

```
backend/better_anki/
  fields.py       Markdown rendering (maths, footnotes, image sizes) and field storage
  search.py       search shorthands on top of Anki's query language
  store.py        the single open collection, behind a lock
  seed.py         the demo collection
  routes/         decks, review, browse/search, notes, stats, media and settings
frontend/src/
  editor/         CodeMirror 6 live preview: maths, marks, clozes, footnotes
  pages/          Contents, Review, Browse, Write, Almanac, Settings
  components/     search box, card panel, hand-drawn sketches (rough.js), charts
  lib/            KaTeX rendering, query parsing and completion, small stores
```
