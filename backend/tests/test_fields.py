import pytest

from better_anki.fields import decode_field, encode_field, html_to_markdown, render_markdown, strip_payload

SAMPLES = [
    "Paris",
    "The map $f: \\R \\to \\R$ with $a_1 < b_1$ is *nice*",
    "$$\n\\int_0^1 x\\,dx\n$$",
    "{{c1::Bolzano}}–Weierstrass[^1]\n\n[^1]: every bounded sequence",
    "inline \\(x_1\\) kept as Anki writes it",
    "price is $5 and $6",
    "two\nlines",
    "```python\nprint('$not maths$')\n```",
    "unicode: ∀ε>0 ∃δ>0 🙂",
]


@pytest.mark.parametrize("source", SAMPLES)
def test_round_trip(source):
    raw = encode_field(source, "front")
    decoded = decode_field(raw)
    assert decoded.source == source
    assert decoded.kind == "md"


def test_maths_becomes_anki_mathjax():
    html = render_markdown("Let $a_1 < b$ and $$x^2$$")
    assert "\\(a_1 &lt; b\\)" in html
    assert "\\[x^2\\]" in html
    # Underscores inside maths must not turn into emphasis.
    assert "<em>" not in html


def test_dollar_amounts_are_not_maths():
    assert "\\(" not in render_markdown("It costs $5 and $6.")


def test_payload_is_invisible_to_search():
    raw = encode_field("**Theorem** about $x$", "f")
    payload = raw[len(strip_payload(raw)) :]
    assert payload.startswith("<!--") and payload.endswith("-->")
    inner = payload[4:-3]
    assert all(0x2800 <= ord(ch) <= 0x28FF for ch in inner)


def test_edits_made_in_anki_desktop_win():
    raw = encode_field("*x* y", "f")
    edited = raw.replace("<em>x</em>", "<b>x</b>")
    decoded = decode_field(edited)
    assert decoded.kind == "html"
    assert decoded.source == "**x** y"


def test_legacy_html_to_markdown():
    md = html_to_markdown('<div>What is <b>\\(x^2&lt;y\\)</b>?</div><ul><li>one</li><li>two</li></ul><img src="a.png">')
    assert "**$x^2<y$**" in md
    assert "- one" in md and "- two" in md
    assert "![](a.png)" in md


def test_empty_field():
    assert encode_field("   ") == ""
    assert decode_field("").source == ""


def test_image_size_syntax():
    assert render_markdown("![graph|300](g.png)") == '<img src="g.png" width="300" alt="graph">'
    assert render_markdown("![|300x200](g.png)") == '<img src="g.png" width="300" height="200" alt="">'
    assert render_markdown("![a|b](g.png)") == '<img src="g.png" alt="a|b">'
