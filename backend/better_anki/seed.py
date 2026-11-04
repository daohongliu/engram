"""A small demo collection so a fresh install has something to look at:
a few decks of maths and computer science cards using Markdown, LaTeX,
clozes and an image. Delete them whenever you like.
"""

from __future__ import annotations

from anki.collection import Collection

from .fields import encode_field

# A small diagram so the demo includes an image card.
UNIT_CIRCLE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="480" height="480">
<rect width="240" height="240" fill="#fbf8f1"/>
<g fill="none" stroke="#887d6e" stroke-width="1">
<path d="M20 120 H220 M120 20 V220"/>
</g>
<circle cx="120" cy="120" r="80" fill="none" stroke="#2a2620" stroke-width="2"/>
<path d="M120 120 L176.6 63.4" stroke="#b4532a" stroke-width="2.2"/>
<path d="M176.6 63.4 V120" stroke="#3c5a78" stroke-width="1.6" stroke-dasharray="4 3"/>
<path d="M145 120 A25 25 0 0 0 137.7 102.3" fill="none" stroke="#b4532a" stroke-width="1.4"/>
<circle cx="176.6" cy="63.4" r="4.5" fill="#b4532a"/>
<g font-family="Georgia, serif" font-style="italic" font-size="15" fill="#2a2620">
<text x="183" y="58">P</text>
<text x="150" y="113" fill="#b4532a">θ</text>
<text x="204" y="136">1</text>
<text x="124" y="34">y</text>
<text x="206" y="112">x</text>
</g>
</svg>
"""

B = "Basic"
R = "Basic (and reversed card)"
C = "Cloze"

NOTES: list[tuple[str, str, list[str], list[str]]] = [
    # ---------------------------------------------------- linear algebra
    (
        "Maths::Linear Algebra",
        B,
        [
            "State the **rank–nullity theorem**.",
            "For a linear map $T: V \\to W$ with $V$ finite-dimensional,\n\n"
            "$$\n\\dim V = \\operatorname{rank} T + \\operatorname{nullity} T.\n$$\n\n"
            "Here $\\operatorname{rank} T = \\dim \\operatorname{im} T$ and "
            "$\\operatorname{nullity} T = \\dim \\ker T$.",
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
    (
        "Maths::Analysis",
        B,
        [
            "![The unit circle|240](unit-circle.svg)\n\nWhat are the coordinates of $P$?",
            "$P = (\\cos\\theta, \\sin\\theta)$.",
        ],
        ["analysis", "trigonometry"],
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
    col.media.write_data("unit-circle.svg", UNIT_CIRCLE_SVG.encode("utf-8"))
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
