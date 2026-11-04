"""A small demo collection so a fresh install has something to look at.

The cards double as a tour of the app: the "Start here" deck explains the
features, and the maths decks show off Markdown, LaTeX, clozes and
footnotes (which become margin notes during review).
"""

from __future__ import annotations

from anki.collection import Collection

from .fields import encode_field

B = "Basic"
R = "Basic (and reversed card)"
C = "Cloze"

NOTES: list[tuple[str, str, list[str], list[str]]] = [
    # ---------------------------------------------------------------- tour
    (
        "Start here",
        B,
        [
            "What happens when you press **space**?",
            "The answer appears below a hand-drawn line. Then press **1–4**:\n\n"
            "1. *Again*: you forgot\n2. *Hard*\n3. *Good*: the usual one\n4. *Easy*\n\n"
            "The little grey numbers on each button say when you will see the card next.",
        ],
        ["tour"],
    ),
    (
        "Start here",
        B,
        [
            "How do I write maths on a card?",
            "Type `$` and start writing LaTeX: $e^{i\\pi} + 1 = 0$. The editor renders it as you type, "
            "Obsidian-style, and shows the source again when your cursor walks back in.\n\n"
            "Display maths uses two dollars:\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$",
        ],
        ["tour", "maths"],
    ),
    (
        "Start here",
        B,
        [
            "What are margin notes?",
            "Footnotes in Markdown[^fn] turn into notes in the right-hand margin while you review, "
            "so asides do not clutter the answer.\n\n"
            "[^fn]: Like this one. Write `[^1]` in the text and `[^1]: …` at the bottom.",
        ],
        ["tour"],
    ),
    (
        "Start here",
        C,
        [
            "In the browser, `{{c1::#tag}}` searches tags, `{{c2::@deck}}` searches decks, "
            "and `{{c3::is:due}}` finds what is waiting for you today.",
            "Everything else in Anki's search language still works, and the sentence under the "
            "search box explains what your query means.",
        ],
        ["tour", "search"],
    ),
    (
        "Start here",
        B,
        [
            "Where are the keyboard shortcuts?",
            "Press `?` anywhere. The two worth learning first are **⌘K** (or Ctrl-K) for the "
            "command palette and **/** to jump to search.",
        ],
        ["tour"],
    ),
    # ---------------------------------------------------- linear algebra
    (
        "Maths::Linear Algebra",
        B,
        [
            "State the **rank–nullity theorem**.",
            "For a linear map $T: V \\to W$ with $V$ finite-dimensional,\n\n"
            "$$\n\\dim V = \\operatorname{rank} T + \\operatorname{nullity} T.\n$$\n\n"
            "Here $\\operatorname{rank} T = \\dim \\operatorname{im} T$ and "
            "$\\operatorname{nullity} T = \\dim \\ker T$.[^1]\n\n"
            "[^1]: Proof sketch: extend a basis of $\\ker T$ to a basis of $V$; the images of the new vectors form a basis of $\\operatorname{im} T$.",
        ],
        ["linalg", "theorem"],
    ),
    (
        "Maths::Linear Algebra",
        B,
        [
            "When is a square matrix $A$ **diagonalisable** over $\\C$?",
            "Exactly when it has a basis of eigenvectors; equivalently, when the minimal polynomial of $A$ "
            "splits into **distinct** linear factors.",
        ],
        ["linalg", "eigen"],
    ),
    (
        "Maths::Linear Algebra",
        C,
        [
            "The **spectral theorem**: every real {{c1::symmetric}} matrix is "
            "{{c2::orthogonally diagonalisable}}, i.e. $A = Q\\Lambda Q^{\\mathsf T}$ with $Q$ {{c3::orthogonal}}.",
            "Its eigenvalues are real and eigenvectors for distinct eigenvalues are orthogonal.",
        ],
        ["linalg", "eigen", "theorem"],
    ),
    (
        "Maths::Linear Algebra",
        R,
        [
            "$\\det(AB)$",
            "$\\det(A)\\det(B)$",
        ],
        ["linalg"],
    ),
    (
        "Maths::Linear Algebra",
        B,
        [
            "What does the **Cayley–Hamilton theorem** say?",
            "Every square matrix satisfies its own characteristic polynomial: if "
            "$\\chi_A(t) = \\det(tI - A)$ then $\\chi_A(A) = 0$.",
        ],
        ["linalg", "theorem"],
    ),
    # ----------------------------------------------------------- analysis
    (
        "Maths::Analysis",
        B,
        [
            "Define: $f$ is **continuous** at $a$.",
            "For every $\\eps > 0$ there is a $\\delta > 0$ such that\n\n"
            "$$\n\\abs{x - a} < \\delta \\implies \\abs{f(x) - f(a)} < \\eps.\n$$",
        ],
        ["analysis", "definition"],
    ),
    (
        "Maths::Analysis",
        C,
        [
            "**Bolzano–Weierstrass**: every {{c1::bounded}} sequence in $\\R^n$ has a "
            "{{c2::convergent subsequence}}.",
            "",
        ],
        ["analysis", "theorem"],
    ),
    (
        "Maths::Analysis",
        B,
        [
            "Is every Cauchy sequence in $\\Q$ convergent in $\\Q$?",
            "No. The decimal truncations $1, 1.4, 1.41, 1.414, \\dots$ of $\\sqrt 2$ are Cauchy in $\\Q$ "
            "but have no rational limit. Completeness is precisely what $\\R$ adds.",
        ],
        ["analysis"],
    ),
    (
        "Maths::Analysis",
        B,
        [
            "State the **mean value theorem**.",
            "If $f$ is continuous on $[a,b]$ and differentiable on $(a,b)$, there is $c \\in (a,b)$ with\n\n"
            "$$\nf'(c) = \\frac{f(b) - f(a)}{b - a}.\n$$",
        ],
        ["analysis", "theorem"],
    ),
    # --------------------------------------------------------- probability
    (
        "Maths::Probability",
        B,
        [
            "Write down **Bayes' theorem**.",
            "$$\n\\mathbb P(A \\mid B) = \\frac{\\mathbb P(B \\mid A)\\,\\mathbb P(A)}{\\mathbb P(B)}\n$$",
        ],
        ["probability"],
    ),
    (
        "Maths::Probability",
        C,
        [
            "If $X \\sim \\mathrm{Poisson}(\\lambda)$ then $\\mathbb E[X] = {{c1::\\lambda}}$ and "
            "$\\operatorname{Var}(X) = {{c2::\\lambda}}$.",
            "",
        ],
        ["probability"],
    ),
    # ---------------------------------------------------------- algorithms
    (
        "Computer Science::Algorithms",
        B,
        [
            "Running time of **Dijkstra's algorithm** with a binary heap?",
            "$O((V + E)\\log V)$. With a Fibonacci heap: $O(E + V \\log V)$.",
        ],
        ["algorithms", "graphs"],
    ),
    (
        "Computer Science::Algorithms",
        B,
        [
            "Solve $T(n) = 2T(n/2) + \\Theta(n)$.",
            "$T(n) = \\Theta(n \\log n)$, by case 2 of the master theorem. This is merge sort.",
        ],
        ["algorithms", "recurrences"],
    ),
    (
        "Computer Science::Algorithms",
        B,
        [
            "What invariant does **binary search** maintain?",
            "If the target is present, it lies in `a[lo..hi)`. Each step halves `hi - lo`, so it ends "
            "after $\\lceil \\log_2 n \\rceil + 1$ comparisons at most.",
        ],
        ["algorithms"],
    ),
    (
        "Computer Science::Functional Programming",
        B,
        [
            "Type of `foldr` in Haskell?",
            "```haskell\nfoldr :: (a -> b -> b) -> b -> [a] -> b\n```\n\n"
            "It replaces each `(:)` with the function and `[]` with the seed.",
        ],
        ["haskell"],
    ),
]


def seed_collection(col: Collection) -> None:
    models = {name: col.models.by_name(name) for name in (B, R, C)}
    for deck_name, notetype, fields, tags in NOTES:
        deck_id = col.decks.id(deck_name)
        nt = models[notetype]
        note = col.new_note(nt)
        names = [f["name"] for f in nt["flds"]]
        for i, src in enumerate(fields):
            note.fields[i] = encode_field(src, doc_id=names[i].lower().replace(" ", ""))
        note.tags = tags
        col.add_note(note, deck_id)
    # The default deck is noise in a fresh collection.
    col.decks.select(col.decks.id("Start here"))
