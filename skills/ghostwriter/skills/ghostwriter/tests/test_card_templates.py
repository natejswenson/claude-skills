"""Deterministic contract for the designed card templates + their stylesheet.

Card templates are static HTML rendered to PNG through `diagram.css`. Whether a
template renders CORRECTLY is deterministic — it's purely "does every class the
HTML uses resolve to a rule in the stylesheet, and does every card type get its
portrait sizing." That was previously only caught by a human eyeballing a render.
These tests close that gap: a typo'd class, a template that references an
undefined selector, or a new card type shipped without a `#canvas...` height rule
now fails here instead of shipping a silently-broken graphic.

The stylesheet under test is the committed `assets/diagram.css.example` (the
personal `~/.claude/ghostwriter/assets/diagram.css` is gitignored and per-user;
the `.example` is the shipped source of truth and the two are kept in sync by
hand — see SKILL.md's Visuals section).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
CSS = (ASSETS / "diagram.css.example").read_text(encoding="utf-8")

# Every designed-card template (the mermaid template is not class-driven).
CARD_TEMPLATES = sorted(ASSETS.glob("card-template*.html"))

# The carousel is a multi-slide DOCUMENT rendered by render_carousel.py (many
# `.slide` pages, no single `#canvas` root), so the per-card `#canvas.card.<type>`
# sizing assertion below does not apply to it. Its classes are still checked.
CAROUSEL = "card-template-carousel.html"

# Class tokens defined anywhere in the stylesheet, harvested from selectors
# (`.foo`, `.card.howto-grid.light`, `.step::before` -> foo, card, howto-grid,
# light, step, ...). Pseudo-elements/classes are stripped by the token regex.
_DEFINED = set(re.findall(r"\.(-?[A-Za-z_][\w-]*)", CSS))

_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def _strip_comments(html: str) -> str:
    # Template header comments carry a class LEGEND (`<span class="t-str/t-num">
    # …`) that documents styling, not real markup — scanning it would false-flag.
    return _COMMENT.sub("", html)


def _used_classes(html: str) -> set[str]:
    tokens: set[str] = set()
    for attr in re.findall(r'class="([^"]*)"', _strip_comments(html)):
        tokens.update(attr.split())
    return tokens


def _canvas_classes(html: str) -> list[str] | None:
    m = re.search(r'id="canvas"\s+class="([^"]*)"', _strip_comments(html))
    return m.group(1).split() if m else None


def test_there_are_card_templates():
    # Guard against a glob that silently matches nothing (which would make the
    # parametrized tests below vacuously pass).
    assert CARD_TEMPLATES, "expected card-template*.html files under assets/"


@pytest.mark.parametrize("tpl", CARD_TEMPLATES, ids=lambda p: p.name)
def test_every_template_class_is_defined(tpl: Path):
    """No template may reference a class the stylesheet never defines (a typo or a
    missing selector would render the element unstyled)."""
    undefined = sorted(c for c in _used_classes(tpl.read_text(encoding="utf-8")) if c not in _DEFINED)
    assert not undefined, (
        f"{tpl.name} uses class(es) with no rule in diagram.css.example: {undefined}."
    )


@pytest.mark.parametrize(
    "tpl", [t for t in CARD_TEMPLATES if t.name != CAROUSEL], ids=lambda p: p.name
)
def test_every_card_type_has_canvas_sizing(tpl: Path):
    """Each single-card template must resolve its `#canvas` to a sizing rule so the
    render gets fixed dimensions. Typed cards need `#canvas.card.<type>`; the
    legacy base `card-template.html` (no type) needs `#canvas.card`."""
    classes = _canvas_classes(tpl.read_text(encoding="utf-8"))
    assert classes and "card" in classes, f"{tpl.name} has no `#canvas` `.card` root"
    type_tokens = [c for c in classes if c not in ("card", "light")]
    if not type_tokens:  # legacy base card — sizing keyed on `.card` itself
        assert re.search(r"#canvas\.card\b", CSS), f"{tpl.name}: no `#canvas.card` sizing rule"
        return
    ctype = type_tokens[0]
    assert re.search(rf"#canvas\.card\.{re.escape(ctype)}\b", CSS), (
        f"{tpl.name} uses card type '{ctype}' but diagram.css.example has no "
        f"`#canvas.card.{ctype}...` sizing rule — the render would size wrong."
    )


def test_howto_family_is_registered_and_synced():
    """The how-to family is the headline of 0.10.0: every variant must have a
    template, a `.card.<type>.light` sizing block, and a SKILL.md reference. Drift
    (a variant in CSS but not shipped, or shipped but unregistered) fails here."""
    skill_md = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    for ctype in ("howto", "howto-grid", "howto-check", "howto-stack"):
        assert (ASSETS / f"card-template-{ctype}.html").exists(), (
            f"missing template for how-to variant '{ctype}'"
        )
        assert f"#canvas.card.{ctype}.light" in CSS, (
            f"diagram.css.example missing the sizing rule for '{ctype}'"
        )
        assert f"card-template-{ctype}.html" in skill_md, (
            f"SKILL.md does not reference card-template-{ctype}.html"
        )
