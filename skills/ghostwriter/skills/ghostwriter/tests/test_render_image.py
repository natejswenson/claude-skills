"""Tests for scripts/render_image.py — full branch coverage (playwright faked)."""
from __future__ import annotations

import builtins
import sys
import types

import pytest

import render_image as ri


# ---------------------------------------------------------------- open_in_viewer
@pytest.mark.parametrize(
    "platform,expected_first",
    [("darwin", "open"), ("win32", "cmd"), ("linux", "xdg-open")],
)
def test_open_in_viewer_per_platform(monkeypatch, tmp_path, platform, expected_first):
    calls = []
    monkeypatch.setattr(ri.sys, "platform", platform)
    monkeypatch.setattr(ri.subprocess, "run", lambda cmd, check: calls.append(cmd))
    ri.open_in_viewer(tmp_path / "x.png")
    assert calls and calls[0][0] == expected_first


def test_open_in_viewer_swallows_errors(monkeypatch, tmp_path):
    def boom(*a, **k):
        raise OSError("nope")

    monkeypatch.setattr(ri.sys, "platform", "darwin")
    monkeypatch.setattr(ri.subprocess, "run", boom)
    ri.open_in_viewer(tmp_path / "x.png")  # must not raise


# ---------------------------------------------------------------- brand_css_path
def test_brand_css_path_prefers_home_dir(monkeypatch, tmp_path):
    # ~/.claude/ghostwriter/assets/diagram.css (shared across Claude Code and Claude
    # Desktop) wins over both the repo copy and the shipped example.
    home = tmp_path / "home-diagram.css"
    home.write_text(":root {}", encoding="utf-8")
    present = tmp_path / "repo-diagram.css"
    present.write_text(":root {}", encoding="utf-8")
    monkeypatch.setattr(ri, "HOME_CSS", home)
    monkeypatch.setattr(ri, "CSS", present)
    assert ri.brand_css_path() == home


def test_brand_css_path_uses_real_when_present(monkeypatch, tmp_path):
    # The real assets/diagram.css is gitignored (personal brand guide), so don't
    # depend on it existing — point CSS at a file we know exists.
    monkeypatch.setattr(ri, "HOME_CSS", tmp_path / "no-home.css")
    present = tmp_path / "diagram.css"
    present.write_text(":root {}", encoding="utf-8")
    monkeypatch.setattr(ri, "CSS", present)
    assert ri.brand_css_path() == present


def test_brand_css_path_falls_back_to_example(monkeypatch, tmp_path):
    monkeypatch.setattr(ri, "HOME_CSS", tmp_path / "no-home.css")
    monkeypatch.setattr(ri, "CSS", tmp_path / "missing.css")
    assert ri.brand_css_path() == ri.CSS_EXAMPLE


# ----------------------------------------------------------------- inline_assets
def test_inline_assets_replaces_css_only():
    html = '<link rel="stylesheet" href="diagram.css" />\n<body></body>'
    out = ri.inline_assets(html)
    assert "<style>" in out
    assert "<link" not in out  # the stylesheet link was replaced by an inline <style>


def test_inline_assets_replaces_mermaid_script():
    html = (
        '<link rel="stylesheet" href="diagram.css" />'
        '<script src="vendor/mermaid.min.js"></script>'
    )
    out = ri.inline_assets(html)
    assert "vendor/mermaid.min.js" not in out
    assert out.count("<script>") >= 1


# ------------------------------------------------------------------- build_html
def test_build_html_card(tmp_path):
    src = tmp_path / "c.html"
    src.write_text('<link href="diagram.css"><div id="canvas">hi</div>', encoding="utf-8")
    out = ri.build_html("card", src)
    assert "<style>" in out


def test_build_html_mermaid(tmp_path):
    src = tmp_path / "d.mmd"
    src.write_text("graph TD; A-->B;", encoding="utf-8")
    out = ri.build_html("mermaid", src)
    assert "A-->B" in out
    assert "%%DIAGRAM%%" not in out


# --------------------------------------------------------- fake playwright plumbing
class _Locator:
    def __init__(self, page):
        self.page = page

    def screenshot(self, path):
        self.page.screenshotted = path


class _Page:
    def __init__(self, behavior):
        self.behavior = behavior
        self.screenshotted = None

    def set_content(self, html, wait_until):
        self.html = html

    def wait_for_function(self, expr, timeout):
        pass

    def evaluate(self, expr):
        return self.behavior.get("render_error")

    def wait_for_selector(self, sel, timeout):
        pass

    def locator(self, sel):
        return _Locator(self)


class _Browser:
    def __init__(self, page, launch_error=None):
        self.page = page
        self.launch_error = launch_error
        self.closed = False

    def new_page(self, viewport, device_scale_factor):
        return self.page

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


def install_fake_playwright(monkeypatch, behavior=None, launch_error=None):
    page = _Page(behavior or {})
    browser = _Browser(page, launch_error=launch_error)
    mod = types.ModuleType("playwright.sync_api")
    mod.sync_playwright = lambda: _PW(browser)
    monkeypatch.setitem(sys.modules, "playwright", types.ModuleType("playwright"))
    monkeypatch.setitem(sys.modules, "playwright.sync_api", mod)
    return page, browser


# ----------------------------------------------------------------------- render
def test_render_playwright_missing(monkeypatch, tmp_path):
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "playwright.sync_api":
            raise ModuleNotFoundError("no playwright")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(SystemExit) as e:
        ri.render("card", "<div id='canvas'></div>", tmp_path / "o.png", 100, 100)
    assert "playwright not installed" in str(e.value)


def test_render_card_success(monkeypatch, tmp_path):
    page, browser = install_fake_playwright(monkeypatch)
    out = tmp_path / "o.png"
    ri.render("card", "<div id='canvas'></div>", out, 100, 100)
    assert page.screenshotted == str(out)
    assert browser.closed


def test_render_mermaid_success(monkeypatch, tmp_path):
    page, browser = install_fake_playwright(monkeypatch, behavior={"render_error": None})
    out = tmp_path / "o.png"
    ri.render("mermaid", "<div id='canvas'></div>", out, 100, 100)
    assert page.screenshotted == str(out)


def test_render_mermaid_error_exits(monkeypatch, tmp_path):
    page, browser = install_fake_playwright(
        monkeypatch, behavior={"render_error": "syntax boom"}
    )
    with pytest.raises(SystemExit) as e:
        ri.render("mermaid", "<div id='canvas'></div>", tmp_path / "o.png", 100, 100)
    assert "mermaid failed" in str(e.value)
    assert browser.closed


def test_render_chromium_missing_hint(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, launch_error="Executable doesn't exist")
    with pytest.raises(SystemExit) as e:
        ri.render("card", "<div id='canvas'></div>", tmp_path / "o.png", 100, 100)
    assert "Chromium not installed" in str(e.value)


def test_render_generic_exception(monkeypatch, tmp_path):
    install_fake_playwright(monkeypatch, launch_error="something odd")
    with pytest.raises(SystemExit) as e:
        ri.render("card", "<div id='canvas'></div>", tmp_path / "o.png", 100, 100)
    assert "while rendering" in str(e.value)


# ------------------------------------------------------------------------- main
def test_main_src_not_found(monkeypatch):
    monkeypatch.setattr(
        "sys.argv", ["x", "--type", "card", "--in", "nope.html", "--out", "o.png"]
    )
    with pytest.raises(SystemExit) as e:
        ri.main()
    assert "source not found" in str(e.value)


def test_main_bad_size(monkeypatch, tmp_path):
    src = tmp_path / "c.html"
    src.write_text("<div id='canvas'></div>", encoding="utf-8")
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "card", "--in", str(src), "--out", str(tmp_path / "o.png"),
         "--size", "bogus"],
    )
    with pytest.raises(SystemExit) as e:
        ri.main()
    assert "--size must look like" in str(e.value)


def test_main_card_happy_path_opens(monkeypatch, tmp_path, capsys):
    src = tmp_path / "c.html"
    src.write_text('<link href="diagram.css"><div id="canvas">hi</div>', encoding="utf-8")
    # Relative --out exercises the REPO-resolution branch.
    out_rel = "build_test_out.png"
    opened = []
    monkeypatch.setattr(ri, "render", lambda *a: None)
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: opened.append(p))
    monkeypatch.setattr(
        "sys.argv", ["x", "--type", "card", "--in", str(src), "--out", out_rel]
    )
    ri.main()
    assert opened == [ri.REPO / out_rel]
    assert "opened in viewer" in capsys.readouterr().out


def test_main_no_open_flag(monkeypatch, tmp_path, capsys):
    src = tmp_path / "d.mmd"
    src.write_text("graph TD; A-->B;", encoding="utf-8")
    out = tmp_path / "o.png"
    opened = []
    monkeypatch.setattr(ri, "render", lambda *a: None)
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: opened.append(p))
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "mermaid", "--in", str(src), "--out", str(out), "--no-open"],
    )
    ri.main()
    assert opened == []
    assert "opened in viewer" not in capsys.readouterr().out
