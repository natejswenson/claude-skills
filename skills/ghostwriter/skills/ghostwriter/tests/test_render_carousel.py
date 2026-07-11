"""Tests for scripts/render_carousel.py — full branch coverage (playwright faked)."""
from __future__ import annotations

import builtins
import sys
import types

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
    rc.open_in_viewer(tmp_path / "x.pdf")
    assert calls and calls[0][0] == expected_first


def test_open_in_viewer_swallows_errors(monkeypatch, tmp_path):
    def boom(*a, **k):
        raise OSError("nope")

    monkeypatch.setattr(rc.sys, "platform", "darwin")
    monkeypatch.setattr(rc.subprocess, "run", boom)
    rc.open_in_viewer(tmp_path / "x.pdf")  # must not raise


# ---------------------------------------------------------------- brand_css_path
def test_brand_css_path_prefers_home_dir(monkeypatch, tmp_path):
    # ~/.claude/ghostwriter/assets/diagram.css (shared across Claude Code and Claude
    # Desktop) wins over both the repo copy and the shipped example.
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
    out = rc.inline_css('<link rel="stylesheet" href="diagram.css" /><body></body>')
    assert "<style>" in out and "<link" not in out


# --------------------------------------------------------- fake playwright plumbing
class _Slide:
    def __init__(self):
        self.shot_path = None

    def screenshot(self, path):
        self.shot_path = path
        # mirror Playwright: write the file AND return the bytes
        from pathlib import Path

        Path(path).write_bytes(b"PNG")
        return b"PNG"


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
        self.pdf_path = None
        self.content = None

    def set_content(self, html, wait_until):
        self.content = html

    def locator(self, sel):
        return _Locator(self.slide_count)

    def pdf(self, path, width, height, print_background, margin):
        self.pdf_path = path
        from pathlib import Path

        Path(path).write_bytes(b"%PDF-1.4")


class _Browser:
    def __init__(self, slide_count, launch_error=None):
        self.slide_count = slide_count
        self.launch_error = launch_error
        self.closed = False
        self.pages = []

    def new_page(self, viewport=None, device_scale_factor=None):
        page = _Page(self.slide_count)
        self.pages.append(page)
        return page

    def close(self):
        self.closed = True


class _Chromium:
    def __init__(self, browser):
        self.browser = browser

    def launch(self):
        if self.browser.launch_error:
            raise Exception(self.browser.launch_error)
        return self.browser


class _PW:
    def __init__(self, browser):
        self.chromium = _Chromium(browser)

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
        rc.render("<body></body>", tmp_path / "o.pdf")
    assert "playwright not installed" in str(e.value)


def test_render_success_makes_pngs_and_pdf(monkeypatch, tmp_path, capsys):
    browser = install_fake_playwright(monkeypatch, slide_count=3)
    pdf = tmp_path / "deck.pdf"
    count = rc.render("<body></body>", pdf)
    assert count == 3
    assert browser.closed
    for i in (1, 2, 3):
        assert (tmp_path / f"deck-{i:02d}.png").exists()
    assert pdf.exists()
    assert "slide 3/3" in capsys.readouterr().out


def test_render_no_slides_exits(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, slide_count=0)
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "o.pdf")
    assert "no .slide elements" in str(e.value)


def test_render_chromium_missing_hint(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, launch_error="Executable doesn't exist")
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "o.pdf")
    assert "Chromium not installed" in str(e.value)


def test_render_generic_exception(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, launch_error="something odd")
    with pytest.raises(SystemExit) as e:
        rc.render("<body></body>", tmp_path / "o.pdf")
    assert "while rendering" in str(e.value)


# ------------------------------------------------------------------------- main
def test_main_src_not_found(monkeypatch):
    monkeypatch.setattr("sys.argv", ["x", "--in", "nope.html", "--out", "o.pdf"])
    with pytest.raises(SystemExit) as e:
        rc.main()
    assert "source not found" in str(e.value)


def test_main_out_not_pdf(monkeypatch, tmp_path):
    src = tmp_path / "c.html"
    src.write_text("<div class='slide'></div>", encoding="utf-8")
    monkeypatch.setattr(
        "sys.argv", ["x", "--in", str(src), "--out", str(tmp_path / "o.png")]
    )
    with pytest.raises(SystemExit) as e:
        rc.main()
    assert "must be a .pdf" in str(e.value)


def test_main_happy_path_opens(monkeypatch, tmp_path, capsys):
    src = tmp_path / "c.html"
    src.write_text('<link href="diagram.css"><div class="slide">hi</div>', encoding="utf-8")
    out_rel = "build_test_deck.pdf"  # relative exercises REPO-resolution branch
    opened = []
    monkeypatch.setattr(rc, "render", lambda html, out: 4)
    monkeypatch.setattr(rc, "inline_css", lambda h: h)
    monkeypatch.setattr(rc, "open_in_viewer", lambda p: opened.append(p))
    monkeypatch.setattr("sys.argv", ["x", "--in", str(src), "--out", out_rel])
    rc.main()
    assert opened == [rc.REPO / out_rel]
    assert "opened the PDF" in capsys.readouterr().out


def test_main_no_open_flag(monkeypatch, tmp_path, capsys):
    src = tmp_path / "c.html"
    src.write_text('<div class="slide">hi</div>', encoding="utf-8")
    out = tmp_path / "o.pdf"
    opened = []
    monkeypatch.setattr(rc, "render", lambda html, out: 2)
    monkeypatch.setattr(rc, "inline_css", lambda h: h)
    monkeypatch.setattr(rc, "open_in_viewer", lambda p: opened.append(p))
    monkeypatch.setattr("sys.argv", ["x", "--in", str(src), "--out", str(out), "--no-open"])
    rc.main()
    assert opened == []
    assert "opened the PDF" not in capsys.readouterr().out
