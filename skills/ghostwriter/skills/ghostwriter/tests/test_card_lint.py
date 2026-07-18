"""Tests for scripts/card_lint.py and its render_image.py integration.

Three layers, mirroring the module:
  * static checks — browser-free, run on raw HTML strings;
  * plumbing — CLI + dom_lint_html covered with a faked playwright module
    (same pattern as tests/test_render_image.py), so coverage is 100% even
    with no browser installed;
  * real DOM checks — rendered in actual Chromium against the shipped
    diagram.css.example; skipped cleanly when Chromium is missing.
"""
from __future__ import annotations

import builtins
import json
import sys
import types

import pytest

import card_lint as cl
import render_image as ri


@pytest.fixture(autouse=True)
def _force_example_css(monkeypatch, tmp_path):
    """Pin inline_assets to the shipped diagram.css.example — never the user's
    personal ~/.claude brand CSS — so DOM measurements are reproducible."""
    monkeypatch.setattr(ri, "HOME_CSS", tmp_path / "no-home.css")
    monkeypatch.setattr(ri, "CSS", tmp_path / "no-repo.css")


# ---------------------------------------------------------------- HTML builders
SKEL = (
    '<!doctype html><html><head><meta charset="utf-8">'
    '<link rel="stylesheet" href="diagram.css" />{style}</head>'
    '<body><div id="canvas" class="{cls}">{body}</div></body></html>'
)
TOPROW = (
    '<div class="toprow"><div class="eyebrow">How-to · Claude Code</div>'
    '<div class="footer brand"></div></div>'
)
BAND = '<div class="band"><div class="btext">The one gotcha, said plainly.</div></div>'
CAPTION = (
    '<div class="caption"><span class="d">●</span>&nbsp; '
    "Ship it · green in one pass</div>"
)


def card(body: str, cls: str = "card howto light", style: str = "") -> str:
    return SKEL.format(body=body, cls=cls, style=style)


def step(t: str, detail: str | None = None, cmd: str | None = None) -> str:
    inner = f'<span class="t">{t}</span>'
    inner += f'<code class="cmd">{cmd}</code>' if cmd else f'<span class="e">{detail}</span>'
    return (
        '<div class="step"><div class="sic tint-blue"></div>'
        f'<div class="sbody">{inner}</div></div>'
    )


def sstep(t: str, detail: str | None = None, cmd: str | None = None) -> str:
    inner = f'<span class="st">{t}</span>'
    inner += f'<code class="cmd">{cmd}</code>' if cmd else f'<span class="se">{detail}</span>'
    return f'<div class="sstep"><div class="sbody">{inner}</div></div>'


def slide(i: int, n: int, body: str, *, i_attr: int | None = None,
          n_attr: int | None = None, pageno: str | None = None) -> str:
    i_attr = i if i_attr is None else i_attr
    n_attr = n if n_attr is None else n_attr
    pageno = f"<b>{i:02d}</b> / {n:02d}" if pageno is None else pageno
    page_span = f'<span class="pageno">{pageno}</span>' if i > 1 else ""
    return (
        f'<div class="slide card point light" style="--i:{i_attr}; --n:{n_attr}">'
        f'<div class="eyebrow">Series · Claude Code</div>{body}{page_span}</div>'
    )


def carousel(n: int, **one_slide_overrides) -> str:
    """n clean slides; keyword overrides (i_attr/n_attr/pageno) hit slide 2."""
    out = []
    for i in range(1, n + 1):
        kw = one_slide_overrides if i == 2 else {}
        out.append(slide(i, n, f"<h2>Point {i}</h2><p>One idea.</p>", **kw))
    return "\n".join(out)


def codes(findings, level=None):
    return [f.code for f in findings if level is None or f.level == level]


# ---------------------------------------------------------------- static checks
def test_icon_fingerprints_harvested_from_templates():
    assert cl.TEMPLATE_ICON_PATHS  # shipped templates contain example icons
    assert all(isinstance(d, str) and d for d in cl.TEMPLATE_ICON_PATHS)


def test_harvest_icon_paths_empty_dir(tmp_path):
    assert cl._harvest_icon_paths(tmp_path) == frozenset()


def _icon_html(with_comment: bool) -> str:
    d = sorted(cl.TEMPLATE_ICON_PATHS)[0]
    comment = "<!-- ICONS: replace these -->" if with_comment else ""
    return card(f'{comment}<svg viewBox="0 0 24 24"><path d="{d}"/></svg>')


def test_default_icon_with_comment_fails():  # fixture (d)
    findings = cl.static_checks(_icon_html(True), "images/my-post.html")
    assert codes(findings, "FAIL").count("default-icon") == 1
    assert "icons-comment" in codes(findings, "FAIL")


def test_default_icon_without_comment_warns():
    findings = cl.static_checks(_icon_html(False), "images/my-post.html")
    assert codes(findings, "WARN") == ["default-icon"]
    assert not codes(findings, "FAIL")


def test_template_file_is_exempt_from_scaffolding_checks():
    findings = cl.static_checks(_icon_html(True), "card-template-howto.html")
    assert not findings


@pytest.mark.parametrize("placeholder", cl.PLACEHOLDER_STRINGS)
def test_placeholder_copy_fails(placeholder):
    findings = cl.static_checks(card(f"<h1>{placeholder}</h1>"), "images/x.html")
    assert codes(findings, "FAIL") == ["placeholder-copy"]
    assert placeholder in findings[0].message


def test_clean_authored_card_has_no_static_findings():
    findings = cl.static_checks(card("<h1>How to ship a CLI fast.</h1>"), "images/x.html")
    assert findings == []


# -------------------------------------------------------------- carousel checks
def test_carousel_clean_eight_slides():
    assert cl.static_checks(carousel(8), "images/x-carousel.html") == []


def test_carousel_n_mismatch_fails():  # fixture (f)
    findings = cl.static_checks(carousel(8, n_attr=9), "images/x-carousel.html")
    assert codes(findings, "FAIL") == ["carousel-sync"]
    assert "--n:9" in findings[0].message


def test_carousel_i_out_of_order_fails():
    findings = cl.static_checks(carousel(8, i_attr=5), "images/x-carousel.html")
    assert "carousel-sync" in codes(findings, "FAIL")
    assert any("--i" in f.message for f in findings)


def test_carousel_missing_counters_fails():
    html = carousel(8).replace('style="--i:3; --n:8"', "")
    findings = cl.static_checks(html, "images/x-carousel.html")
    assert codes(findings, "FAIL").count("carousel-sync") == 2  # both --i and --n


def test_carousel_pageno_text_mismatch_fails():
    findings = cl.static_checks(
        carousel(8, pageno="<b>02</b> / 09"), "images/x-carousel.html"
    )
    assert codes(findings, "FAIL") == ["carousel-sync"]
    assert '"02 / 08"' in findings[0].message


def test_carousel_slide_count_out_of_blueprint_warns():
    findings = cl.static_checks(carousel(5), "images/x-carousel.html")
    assert codes(findings, "WARN") == ["slide-count"]
    assert not codes(findings, "FAIL")


def test_carousel_wordy_slide_warns():
    wordy = carousel(8).replace(
        "<p>One idea.</p>", "<p>" + "word " * 40 + "</p>", 1
    )
    findings = cl.static_checks(wordy, "images/x-carousel.html")
    assert codes(findings, "WARN") == ["slide-words"]


def test_shipped_carousel_template_is_in_sync():
    tpl = cl.ASSETS / "card-template-carousel.html"
    assert cl.static_checks(tpl.read_text(encoding="utf-8"), tpl) == []


# ------------------------------------------------------------------- exit_code
def test_exit_code_levels():
    warn = cl.Finding("WARN", "x", "m")
    fail = cl.Finding("FAIL", "y", "m")
    assert cl.exit_code([]) == 0
    assert cl.exit_code([warn]) == 1
    assert cl.exit_code([warn, fail]) == 2
    assert fail.line() == "FAIL y: m"


# ------------------------------------------- fake playwright (coverage plumbing)
class _FakePage:
    def __init__(self, findings):
        self._findings = findings

    def set_content(self, html, wait_until):
        self.html = html

    def wait_for_selector(self, sel, timeout):
        pass

    def evaluate(self, js):
        return self._findings

    def locator(self, sel):
        page = self

        class _Loc:
            def screenshot(self, path):
                page.screenshotted = path

        return _Loc()


class _FakeBrowser:
    def __init__(self, page):
        self.page = page
        self.closed = False

    def new_page(self, **kw):
        return self.page

    def close(self):
        self.closed = True


class _FakePW:
    def __init__(self, browser):
        self.chromium = types.SimpleNamespace(launch=lambda: browser)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def install_fake_playwright(monkeypatch, findings):
    page = _FakePage(findings)
    browser = _FakeBrowser(page)
    mod = types.ModuleType("playwright.sync_api")
    mod.sync_playwright = lambda: _FakePW(browser)
    monkeypatch.setitem(sys.modules, "playwright", types.ModuleType("playwright"))
    monkeypatch.setitem(sys.modules, "playwright.sync_api", mod)
    return page, browser


def test_lint_page_maps_raw_findings_to_dataclasses():
    page = _FakePage([{"level": "WARN", "code": "chip-wrap", "message": "m"}])
    findings = cl.lint_page(page)
    assert findings == [cl.Finding("WARN", "chip-wrap", "m")]


def test_dom_lint_html_via_fake_playwright(monkeypatch):
    raw = [{"level": "FAIL", "code": "clip-overflow", "message": "m"}]
    page, browser = install_fake_playwright(monkeypatch, raw)
    findings = cl.dom_lint_html(card("<h1>Hi.</h1>"))
    assert codes(findings, "FAIL") == ["clip-overflow"]
    assert browser.closed
    assert "<style>" in page.html  # brand CSS was inlined before linting


def test_dom_lint_html_playwright_missing(monkeypatch):
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "playwright.sync_api":
            raise ModuleNotFoundError("no playwright")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(SystemExit) as e:
        cl.dom_lint_html(card("<h1>Hi.</h1>"))
    assert "playwright not installed" in str(e.value)


# ------------------------------------------------------------------ lint CLI
def test_cli_src_not_found():
    with pytest.raises(SystemExit) as e:
        cl.main(["--in", "nope-not-there.html"])
    assert "source not found" in str(e.value)


def test_cli_carousel_static_only_exit_2(tmp_path, capsys):
    src = tmp_path / "c-carousel.html"
    src.write_text(carousel(8, n_attr=9), encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        cl.main(["--in", str(src), "--type", "carousel"])
    assert e.value.code == 2
    assert "FAIL carousel-sync:" in capsys.readouterr().out


def test_cli_json_output(tmp_path, capsys):
    src = tmp_path / "c-carousel.html"
    src.write_text(carousel(5), encoding="utf-8")  # WARN-only -> exit 1
    with pytest.raises(SystemExit) as e:
        cl.main(["--in", str(src), "--type", "carousel", "--json"])
    assert e.value.code == 1
    parsed = json.loads(capsys.readouterr().out)
    assert [f["code"] for f in parsed] == ["slide-count"]


def test_cli_card_runs_dom_checks_and_resolves_relative_paths(
    monkeypatch, tmp_path, capsys
):
    monkeypatch.setattr(cl, "REPO", tmp_path)
    (tmp_path / "c.html").write_text(card("<h1>Hi.</h1>"), encoding="utf-8")
    install_fake_playwright(
        monkeypatch, [{"level": "WARN", "code": "empty-band", "message": "gap"}]
    )
    with pytest.raises(SystemExit) as e:
        cl.main(["--in", "c.html"])
    assert e.value.code == 1
    assert "WARN empty-band: gap" in capsys.readouterr().out


# --------------------------------------------------- render_image integration
def _write_card(tmp_path, html=None):
    src = tmp_path / "c.html"
    src.write_text(html or card("<h1>Hi.</h1>"), encoding="utf-8")
    return src


def test_render_runs_lint_before_screenshot(monkeypatch, tmp_path):
    install_fake_playwright(
        monkeypatch, [{"level": "FAIL", "code": "clip-overflow", "message": "m"}]
    )
    findings = ri.render("card", card("<h1>Hi.</h1>"), tmp_path / "o.png", 100, 100, True)
    assert codes(findings, "FAIL") == ["clip-overflow"]


def test_render_lint_bug_is_nonfatal(monkeypatch, tmp_path, capsys):
    install_fake_playwright(monkeypatch, [])
    monkeypatch.setattr(
        cl, "lint_page", lambda page: (_ for _ in ()).throw(RuntimeError("lint boom"))
    )
    findings = ri.render("card", card("<h1>Hi.</h1>"), tmp_path / "o.png", 100, 100, True)
    assert findings == []
    assert "LINT ERROR (non-fatal)" in capsys.readouterr().err


def test_main_prints_findings_to_stderr_without_changing_exit(
    monkeypatch, tmp_path, capsys
):
    src = _write_card(tmp_path, card("<h1>Eyebrow Label</h1>"))  # static FAIL
    monkeypatch.setattr(ri, "render", lambda *a: [])
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: None)
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "card", "--in", str(src), "--out", str(tmp_path / "o.png")],
    )
    ri.main()  # no SystemExit — default exit code never changes
    err = capsys.readouterr().err
    assert "FAIL placeholder-copy:" in err


def test_main_strict_exits_2_on_fail(monkeypatch, tmp_path):
    src = _write_card(tmp_path, card("<h1>Eyebrow Label</h1>"))
    monkeypatch.setattr(ri, "render", lambda *a: [])
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: None)
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "card", "--in", str(src), "--out", str(tmp_path / "o.png"),
         "--strict"],
    )
    with pytest.raises(SystemExit) as e:
        ri.main()
    assert e.value.code == 2


def test_main_strict_passes_clean_card(monkeypatch, tmp_path):
    src = _write_card(tmp_path)
    monkeypatch.setattr(ri, "render", lambda *a: [])
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: None)
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "card", "--in", str(src), "--out", str(tmp_path / "o.png"),
         "--strict"],
    )
    ri.main()  # clean card + --strict: no exit


def test_main_no_lint_skips_both_layers(monkeypatch, tmp_path, capsys):
    src = _write_card(tmp_path, card("<h1>Eyebrow Label</h1>"))  # would FAIL
    seen = {}
    monkeypatch.setattr(
        ri, "render", lambda kind, html, out, w, h, lint=False: seen.update(lint=lint) or []
    )
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: None)
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "card", "--in", str(src), "--out", str(tmp_path / "o.png"),
         "--no-lint"],
    )
    ri.main()
    assert seen["lint"] is False
    assert "placeholder-copy" not in capsys.readouterr().err


def test_main_static_check_bug_is_nonfatal(monkeypatch, tmp_path, capsys):
    src = _write_card(tmp_path)
    monkeypatch.setattr(ri, "render", lambda *a: [])
    monkeypatch.setattr(ri, "open_in_viewer", lambda p: None)
    monkeypatch.setattr(
        cl, "static_checks", lambda *a: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    monkeypatch.setattr(
        "sys.argv",
        ["x", "--type", "card", "--in", str(src), "--out", str(tmp_path / "o.png")],
    )
    ri.main()  # never fatal
    assert "LINT ERROR (non-fatal)" in capsys.readouterr().err


# ------------------------------------------------------- real Chromium DOM lint
@pytest.fixture(scope="module")
def dom_page():
    pw = pytest.importorskip("playwright.sync_api")
    ctx = pw.sync_playwright().start()
    try:
        browser = ctx.chromium.launch()
    except Exception as e:  # chromium not downloaded
        ctx.stop()
        pytest.skip(f"chromium unavailable: {e}")
    page = browser.new_page(viewport={"width": 1200, "height": 1500})
    yield page
    browser.close()
    ctx.stop()


def run_dom(page, html):
    page.set_content(ri.inline_assets(html), wait_until="load")
    page.wait_for_selector("#canvas", timeout=5000)
    return cl.lint_page(page)


def test_dom_empty_band_fails_on_short_stack(dom_page):  # fixture (a)
    html = card(
        TOPROW + "<h1>Short.</h1>"
        + '<div class="stack">'
        + sstep("One", "tiny") + sstep("Two", "tiny") + sstep("Three", "tiny")
        + "</div>",
        cls="card howto-stack light",
        style=(
            "<style>"
            ".card.howto-stack.light .stack{margin:0 !important; flex:0 0 auto !important;"
            " gap:8px !important}"
            ".card.howto-stack.light .st{font-size:22px !important}"
            ".card.howto-stack.light .sstep{padding:4px 0 !important; min-height:0 !important}"
            ".card.howto-stack.light .sstep::before{font-size:30px !important}"
            "</style>"
        ),
    )
    findings = run_dom(dom_page, html)
    assert "empty-band" in codes(findings, "FAIL")


def test_dom_long_cmd_wraps_instead_of_ellipsizing(dom_page):  # fixture (b)
    long_cmd = (
        "npx -y @natjswenson/shipflow@latest apply --repo . --branch dev "
        "--merge-method merge --cleanup"
    )  # ~90 chars
    html = card(
        TOPROW + "<h1>How to wire the release tag.</h1>"
        + '<div class="steps">'
        + step("Scaffold the repo", "one command sets up CI")
        + step("Wire the release", cmd=long_cmd)
        + step("Verify it worked", "the tag builds itself")
        + "</div>" + BAND + CAPTION,
    )
    findings = run_dom(dom_page, html)
    assert "chip-wrap" in codes(findings, "WARN")
    assert "ellipsis-fired" not in codes(findings)  # wraps, never truncates


def test_dom_clip_overflow_fails_on_offcanvas_element(dom_page):  # fixture (c)
    html = card(
        TOPROW + "<h1>How to do the thing.</h1>"
        + '<div class="steps">'
        + step("One", "detail") + step("Two", "detail") + step("Three", "detail")
        + "</div>" + BAND + CAPTION
        + '<div style="position:absolute; top:1600px; left:100px">pushed off</div>',
    )
    findings = run_dom(dom_page, html)
    clips = [f for f in findings if f.code == "clip-overflow" and f.level == "FAIL"]
    assert clips
    assert any("pushed off" in f.message for f in clips)


def test_dom_clean_stack_card_is_flawless(dom_page):  # fixture (e)
    html = card(
        TOPROW + "<h1>How to ship a CLI fast.</h1>"
        + '<p class="lead">One line on the payoff, with the'
        ' <strong>real win</strong> in bold.</p>'
        + '<div class="stack">'
        + sstep("Scaffold the repo", "one command sets up CI and tests")
        + sstep("Wire the release tag", cmd="npx shipflow apply --repo .")
        + sstep("Cut the release", "the tag builds and publishes itself")
        + "</div>" + BAND + CAPTION,
        cls="card howto-stack light",
    )
    assert run_dom(dom_page, html) == []  # zero findings: first render is excellent
    # And the same authored content is statically clean too.
    assert cl.static_checks(html, "images/ship-a-cli.html") == []


def test_dom_count_budget_fails_on_six_steps(dom_page):
    html = card(
        TOPROW + "<h1>How to do the thing.</h1>"
        + '<div class="steps">'
        + "".join(step(f"Step {i}", "detail") for i in range(6))
        + "</div>" + BAND + CAPTION,
    )
    findings = run_dom(dom_page, html)
    assert any(
        f.code == "count-budget" and "6 steps" in f.message
        for f in findings if f.level == "FAIL"
    )


def test_dom_matrix_cols_mismatch_fails(dom_page):
    html = card(
        TOPROW + "<h1>Pick one.</h1>"
        + '<div class="grid"><div class="corner"></div>'
        '<div class="col-h">A</div><div class="col-h">B</div></div>' + CAPTION,
        cls="card matrix light",
    )
    findings = run_dom(dom_page, html)
    assert any(
        f.code == "matrix-cols" and 'class "grid cols2"' in f.message
        for f in findings if f.level == "FAIL"
    )


def test_dom_code_line_budget_fails_at_14_rows(dom_page):
    html = card(
        TOPROW + "<h1>The snippet.</h1>"
        + '<div class="terminal"><div class="body">'
        + "".join(
            f'<div class="line"><span class="src">line {i}</span></div>'
            for i in range(14)
        )
        + "</div></div>" + CAPTION,
        cls="card code light",
    )
    findings = run_dom(dom_page, html)
    assert any(
        f.code == "count-budget" and "14 code lines" in f.message
        for f in findings if f.level == "FAIL"
    )
