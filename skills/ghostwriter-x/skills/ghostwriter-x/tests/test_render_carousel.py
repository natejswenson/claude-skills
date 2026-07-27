"""Tests for scripts/render_carousel.py — full branch coverage (playwright faked).

X carousels render to per-slide 16:9 PNGs only (no PDF — X has no documents);
>4 slides is refused unless --allow-many (thread-with-images).
"""
from __future__ import annotations

import builtins
import sys
import types
from pathlib import Path

import pytest

import render_carousel as rc


# ---------------------------------------------------------------- open_in_viewer
@pytest.mark.parametrize(
    "platform,expected_first",
    [("darwin", "open"), ("win32", "cmd"), ("linux", "xdg-open")],
)
def test_open_in_viewer_per_platform(monkeypatch, tmp_path, platform, expected_first):
    calls = []
    monkeypatch.setattr(rc.sys, "platform", platform)
    monkeypatch.setattr(rc.subprocess, "run", lambda cmd, check: calls.append(cmd))
    rc.open_in_viewer(tmp_path / "x.png")
    assert calls and calls[0][0] == expected_first


def test_open_in_viewer_swallows_errors(monkeypatch, tmp_path):
    def boom(*a, **k):
        raise OSError("nope")

    monkeypatch.setattr(rc.sys, "platform", "darwin")
    monkeypatch.setattr(rc.subprocess, "run", boom)
    rc.open_in_viewer(tmp_path / "x.png")  # must not raise


# ---------------------------------------------------------------- brand_css_path
def test_brand_css_path_prefers_home_dir(monkeypatch, tmp_path):
    # ~/.claude/ghostwriter-x/assets/diagram.css (shared across Claude Code and
    # Claude Desktop) wins over both the repo copy and the shipped example.
    home = tmp_path / "home-diagram.css"
    home.write_text(":root {}", encoding="utf-8")
    present = tmp_path / "repo-diagram.css"
    present.write_text(":root {}", encoding="utf-8")
    monkeypatch.setattr(rc, "HOME_CSS", home)
    monkeypatch.setattr(rc, "CSS", present)
    assert rc.brand_css_path() == home


def test_brand_css_path_uses_real_when_present(monkeypatch, tmp_path):
    monkeypatch.setattr(rc, "HOME_CSS", tmp_path / "no-home.css")
    present = tmp_path / "diagram.css"
    present.write_text(":root {}", encoding="utf-8")
    monkeypatch.setattr(rc, "CSS", present)
    assert rc.brand_css_path() == present


def test_brand_css_path_falls_back_to_example(monkeypatch, tmp_path):
    monkeypatch.setattr(rc, "HOME_CSS", tmp_path / "no-home.css")
    monkeypatch.setattr(rc, "CSS", tmp_path / "missing.css")
    assert rc.brand_css_path() == rc.CSS_EXAMPLE


# ------------------------------------------------------------------- inline_css
def test_inline_css_replaces_link(monkeypatch, tmp_path):
    css = tmp_path / "diagram.css"
    css.write_text(":root{--x:1}", encoding="utf-8")
    monkeypatch.setattr(rc, "CSS", css)
    monkeypatch.setattr(rc, "HOME_CSS", tmp_path / "no-home.css")
    out = rc.inline_css('<link rel="stylesheet" href="diagram.css" /><body></body>')
    assert "<style>" in out and "<link" not in out


# ------------------------------------------------------------------- slide_stem
def test_slide_stem_strips_carousel_suffix(tmp_path):
    assert rc.slide_stem(tmp_path / "foo-carousel.html") == tmp_path / "foo"


def test_slide_stem_plain_name_keeps_stem(tmp_path):
    assert rc.slide_stem(tmp_path / "deck.html") == tmp_path / "deck"


# ----------------------------------------------------------------- publish_hint
def test_publish_hint_four_or_fewer_attach_to_tweet_one(tmp_path):
    hint = rc.publish_hint(tmp_path / "foo", 3)
    assert "--image images/foo-01.png" in hint
    assert "--image images/foo-03.png" in hint
    assert "1:" not in hint  # all ride tweet 1 (the default)


def test_publish_hint_many_slides_one_per_tweet(tmp_path):
    hint = rc.publish_hint(tmp_path / "foo", 6)
    assert "--image 1:images/foo-01.png" in hint
    assert "--image 6:images/foo-06.png" in hint


# --------------------------------------------------------- fake playwright plumbing
class _Slide:
    def screenshot(self, path):
        Path(path).write_bytes(b"PNG")


class _Locator:
    def __init__(self, n):
        self._n = n
        self._slides = [_Slide() for _ in range(n)]

    def count(self):
        return self._n

    def nth(self, i):
        return self._slides[i]


class _Page:
    def __init__(self, slide_count):
        self.slide_count = slide_count

    def set_content(self, html, wait_until):
        self.content = html

    def locator(self, sel):
        return _Locator(self.slide_count)


class _Browser:
    def __init__(self, slide_count, launch_error=None):
        self.slide_count = slide_count
        self.launch_error = launch_error
        self.closed = False

    def new_page(self, viewport=None, device_scale_factor=None):
        return _Page(self.slide_count)

    def close(self):
        self.closed = True


class _PW:
    def __init__(self, browser):
        self.chromium = types.SimpleNamespace(
            launch=lambda: (_ for _ in ()).throw(Exception(browser.launch_error))
            if browser.launch_error else browser
        )

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def install_fake_playwright(monkeypatch, slide_count=3, launch_error=None):
    browser = _Browser(slide_count, launch_error=launch_error)
    mod = types.ModuleType("playwright.sync_api")
    mod.sync_playwright = lambda: _PW(browser)
    monkeypatch.setitem(sys.modules, "playwright", types.ModuleType("playwright"))
    monkeypatch.setitem(sys.modules, "playwright.sync_api", mod)
    return browser


# ----------------------------------------------------------------------- render
def test_render_playwright_missing(monkeypatch, tmp_path):
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "playwright.sync_api":
            raise ModuleNotFoundError("no playwright")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "deck", 4, False)
    assert "playwright not installed" in str(e.value)


def test_render_success_makes_pngs(monkeypatch, tmp_path, capsys):
    browser = install_fake_playwright(monkeypatch, slide_count=3)
    count = rc.render("<body></body>", tmp_path / "deck", 4, False)
    assert count == 3
    assert browser.closed
    for i in (1, 2, 3):
        assert (tmp_path / f"deck-{i:02d}.png").exists()
    assert "slide 3/3" in capsys.readouterr().out


def test_render_no_slides_exits(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, slide_count=0)
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "deck", 4, False)
    assert "no .slide elements" in str(e.value)


def test_render_too_many_slides_refused(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, slide_count=6)
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "deck", 4, False)
    assert "--allow-many" in str(e.value)
    assert not (tmp_path / "deck-01.png").exists()  # refused BEFORE rendering


def test_render_many_slides_allowed_with_flag(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, slide_count=6)
    assert rc.render("<body></body>", tmp_path / "deck", 4, True) == 6
    assert (tmp_path / "deck-06.png").exists()


def test_render_chromium_missing_hint(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, launch_error="Executable doesn't exist")
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "deck", 4, False)
    assert "Chromium not installed" in str(e.value)


def test_render_generic_exception(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, launch_error="something odd")
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "deck", 4, False)
    assert "while rendering" in str(e.value)


# ------------------------------------------------------------------------- main
def test_main_src_not_found(monkeypatch):
    monkeypatch.setattr("sys.argv", ["x", "--in", "nope.html"])
    with pytest.raises(SystemExit) as e:
        rc.main()
    assert "source not found" in str(e.value)


def test_main_happy_path_opens_first_png(monkeypatch, tmp_path, capsys):
    src = tmp_path / "c-carousel.html"
    src.write_text('<link href="diagram.css"><div class="slide">hi</div>', encoding="utf-8")
    opened = []
    monkeypatch.setattr(rc, "render", lambda html, stem, mx, many: 4)
    monkeypatch.setattr(rc, "inline_css", lambda h: h)
    monkeypatch.setattr(rc, "open_in_viewer", lambda p: opened.append(p))
    monkeypatch.setattr("sys.argv", ["x", "--in", str(src)])
    rc.main()
    assert opened == [tmp_path / "c-01.png"]
    out = capsys.readouterr().out
    assert "opened the first" in out
    assert "x_post.py" in out  # the publish hint


def test_main_relative_src_and_no_open(monkeypatch, tmp_path, capsys):
    rel = "build_test-carousel.html"
    (rc.REPO / rel).write_text('<div class="slide">hi</div>', encoding="utf-8")
    opened = []
    monkeypatch.setattr(rc, "render", lambda html, stem, mx, many: 2)
    monkeypatch.setattr(rc, "inline_css", lambda h: h)
    monkeypatch.setattr(rc, "open_in_viewer", lambda p: opened.append(p))
    monkeypatch.setattr("sys.argv", ["x", "--in", rel, "--no-open"])
    try:
        rc.main()
    finally:
        (rc.REPO / rel).unlink()
    assert opened == []
    assert "opened the first" not in capsys.readouterr().out
