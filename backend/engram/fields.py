"""How Markdown lives inside an Anki field.

Anki fields hold HTML, and every Anki client (desktop, AnkiMobile, AnkiDroid)
expects to find HTML there with maths written as ``\\(...\\)`` for MathJax.
We want to write Markdown with ``$...$`` maths instead, without breaking
those clients. So a field written by Engram looks like this::

    <p>The derivative of <code>\\(x^2\\)</code> ...</p><!--⠿⠓⠊⠿⠁⠃⠉⠙-->

The visible part is ordinary HTML rendered from the Markdown. The trailing
HTML comment carries the original Markdown source, encoded one byte per
Braille-pattern character (U+2800 to U+28FF). Braille is used rather than
base64 so that Anki's plain-text search, which looks at raw field content,
never gets false matches from the encoded payload: nobody searches for ⠓⠊.

After the source comes a 4-byte fingerprint of the HTML part. If someone
edits the field in Anki desktop, the HTML no longer matches the
fingerprint, and we fall back to treating the HTML as the source of truth.
"""

from __future__ import annotations

import hashlib
import html as htmllib
import re
from dataclasses import dataclass

from markdown_it import MarkdownIt
from markdown_it.rules_inline import StateInline
from mdit_py_plugins.dollarmath import dollarmath_plugin

BRAILLE_BASE = 0x2800
SEP = "⣿"  # ⠿, also a valid payload byte (0xff never occurs in UTF-8)
_COMMENT_RE = re.compile(
    r"<!--" + SEP + r"([⠀-⣾]*)" + SEP + r"([⠀-⣿]{4})-->\s*$"
)


def _to_braille(data: bytes) -> str:
    return "".join(chr(BRAILLE_BASE + b) for b in data)


def _from_braille(text: str) -> bytes:
    return bytes(ord(ch) - BRAILLE_BASE for ch in text)


def _fingerprint(html: str) -> bytes:
    return hashlib.sha1(html.encode("utf-8")).digest()[:4]


# --------------------------------------------------------------------------
# Markdown → Anki-flavoured HTML
# --------------------------------------------------------------------------


def _math_inline(content: str, _info: dict) -> str:
    return "\\(" + htmllib.escape(content, quote=False) + "\\)"


def _math_block(content: str, _info: dict) -> str:
    return "\\[" + htmllib.escape(content.strip("\n"), quote=False) + "\\]"


def _paren_math(state: StateInline, silent: bool) -> bool:
    """Accept ``\\(...\\)`` and ``\\[...\\]`` as maths, as Anki does.

    Without this rule Markdown would treat ``\\(`` as an escaped bracket and
    silently drop the backslash.
    """
    src, pos = state.src, state.pos
    if not src.startswith("\\", pos) or pos + 1 >= len(src):
        return False
    opener = src[pos + 1]
    if opener not in "([":
        return False
    closer = "\\)" if opener == "(" else "\\]"
    end = src.find(closer, pos + 2)
    if end < 0:
        return False
    if not silent:
        token = state.push("math_inline" if opener == "(" else "math_inline_double", "math", 0)
        token.content = src[pos + 2 : end]
        token.markup = "\\" + opener
    state.pos = end + 2
    return True


_SIZE_RE = re.compile(r"^(.*?)\|\s*(\d+)(?:\s*x\s*(\d+))?\s*$")


def _image(self, tokens, idx, options, env) -> str:
    """Images, with Obsidian's size syntax: ![caption|300](file.png).

    The number after the bar is a width in pixels; "300x200" sets both.
    Images are never stretched beyond their natural size or the card.
    """
    token = tokens[idx]
    alt = self.renderInlineAsText(token.children or [], options, env)
    src = htmllib.escape(token.attrGet("src") or "", quote=True)
    attrs = [f'src="{src}"']
    match = _SIZE_RE.match(alt)
    if match:
        alt = match.group(1).strip()
        attrs.append(f'width="{match.group(2)}"')
        if match.group(3):
            attrs.append(f'height="{match.group(3)}"')
    attrs.append(f'alt="{htmllib.escape(alt, quote=True)}"')
    title = token.attrGet("title")
    if title:
        attrs.append(f'title="{htmllib.escape(str(title), quote=True)}"')
    return f"<img {' '.join(attrs)}>"


def _build_md() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": True, "breaks": True, "typographer": False})
    md.enable(["table", "strikethrough"])
    md.use(dollarmath_plugin, double_inline=True, allow_digits=False, allow_space=False)
    md.inline.ruler.before("escape", "paren_math", _paren_math)
    md.add_render_rule("image", _image)
    md.add_render_rule("math_inline", lambda self, tokens, idx, options, env: _math_inline(tokens[idx].content, {}))
    md.add_render_rule(
        "math_inline_double",
        lambda self, tokens, idx, options, env: _math_block(tokens[idx].content, {}),
    )
    md.add_render_rule(
        "math_block",
        lambda self, tokens, idx, options, env: "<div class=\"math-display\">"
        + _math_block(tokens[idx].content, {})
        + "</div>\n",
    )
    md.add_render_rule(
        "math_block_label",
        lambda self, tokens, idx, options, env: "<div class=\"math-display\">"
        + _math_block(tokens[idx].content, {})
        + "</div>\n",
    )
    return md


_MD = _build_md()


def render_markdown(source: str, doc_id: str = "f") -> str:
    """Render Markdown to the HTML we store in the field."""
    if not source.strip():
        return ""
    out = _MD.render(source, {"docId": doc_id}).strip()
    # A single paragraph is the common case for flashcards. Dropping the
    # wrapper keeps fields tidy in Anki desktop and avoids extra margins.
    if out.startswith("<p>") and out.endswith("</p>") and out.count("<p>") == 1:
        out = out[3:-4]
    return out


# --------------------------------------------------------------------------
# Encoding and decoding fields
# --------------------------------------------------------------------------


@dataclass
class FieldContent:
    source: str  # what the editor shows: Markdown
    html: str  # what Anki sees (without our comment)
    kind: str  # "md" if we wrote it, "html" if it came from elsewhere


def encode_field(source: str, doc_id: str = "f") -> str:
    source = source.replace("\r\n", "\n")
    html = render_markdown(source, doc_id)
    if not source.strip():
        return ""
    # If the Markdown renders to exactly itself (plain words), there is no
    # point carrying a copy of the source.
    if html == source and not any(ch in source for ch in "<&\\"):
        return html
    payload = _to_braille(source.encode("utf-8"))
    return f"{html}<!--{SEP}{payload}{SEP}{_to_braille(_fingerprint(html))}-->"


def decode_field(raw: str) -> FieldContent:
    match = _COMMENT_RE.search(raw)
    if match:
        html = raw[: match.start()]
        if _from_braille(match.group(2)) == _fingerprint(html):
            try:
                source = _from_braille(match.group(1)).decode("utf-8")
                return FieldContent(source=source, html=html, kind="md")
            except UnicodeDecodeError:
                pass
        raw = html  # edited elsewhere: the HTML wins
    if "<" not in raw and "&" not in raw and "\\" not in raw:
        return FieldContent(source=raw, html=raw, kind="md")
    return FieldContent(source=html_to_markdown(raw), html=raw, kind="html")


def strip_payload(raw: str) -> str:
    """The field without our source comment (for display and previews)."""
    match = _COMMENT_RE.search(raw)
    return raw[: match.start()] if match else raw


# --------------------------------------------------------------------------
# Legacy HTML → Markdown (best effort)
# --------------------------------------------------------------------------

_SIMPLE_TAGS = [
    (re.compile(r"<\s*(b|strong)\s*>(.*?)<\s*/\s*\1\s*>", re.S | re.I), r"**\2**"),
    (re.compile(r"<\s*(i|em)\s*>(.*?)<\s*/\s*\1\s*>", re.S | re.I), r"*\2*"),
    (re.compile(r"<\s*(s|del|strike)\s*>(.*?)<\s*/\s*\1\s*>", re.S | re.I), r"~~\2~~"),
    (re.compile(r"<\s*code\s*>(.*?)<\s*/\s*code\s*>", re.S | re.I), r"`\1`"),
]
_IMG_RE = re.compile(r"<img\s+[^>]*?src=[\"']([^\"']+)[\"'][^>]*>", re.I)
_BLOCK_BREAK_RE = re.compile(r"<\s*(br\s*/?|/div|/p|/li)\s*>", re.I)
_BLOCK_OPEN_RE = re.compile(r"<\s*(div|p)(\s[^>]*)?>", re.I)
_LI_RE = re.compile(r"<\s*li(\s[^>]*)?>", re.I)
_LIST_WRAP_RE = re.compile(r"<\s*/?\s*(ul|ol)(\s[^>]*)?>", re.I)
_BARE_SPAN_RE = re.compile(r"<\s*/?\s*span\s*>", re.I)


def html_to_markdown(raw: str) -> str:
    """Turn typical Anki-editor HTML into readable Markdown.

    Anything we do not recognise stays as inline HTML, which Markdown
    renders unchanged, so the conversion never loses content.
    """
    text = raw
    text = re.sub(r"\\\((.*?)\\\)", lambda m: "$" + htmllib.unescape(m.group(1)).strip() + "$", text, flags=re.S)
    text = re.sub(
        r"\\\[(.*?)\\\]", lambda m: "$$" + htmllib.unescape(m.group(1)).strip() + "$$", text, flags=re.S
    )
    for pattern, repl in _SIMPLE_TAGS:
        text = pattern.sub(repl, text)
    text = _IMG_RE.sub(lambda m: f"![]({m.group(1)})", text)
    text = _LI_RE.sub("- ", text)
    text = _LIST_WRAP_RE.sub("\n", text)
    text = _BLOCK_BREAK_RE.sub("\n", text)
    text = _BLOCK_OPEN_RE.sub("", text)
    text = _BARE_SPAN_RE.sub("", text)
    text = text.replace("&nbsp;", " ")
    if not re.search(r"<[a-zA-Z/]", text):
        text = htmllib.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
