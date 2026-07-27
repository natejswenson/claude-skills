#!/usr/bin/env python3
"""Layout + content lint for ghostwriter-x cards (landscape 16:9, 1200×675).

Two layers:

  * Static checks — run on the raw authored HTML string, no browser needed:
    leftover template scaffolding (default icons, the ICONS: comment,
    placeholder copy), terminal fidelity, and carousel slide-counter sync.
  * DOM checks — `lint_page(page)` measures the already-rendered page in
    Chromium: clipped/overflowing content, fired ellipses, wrapped eyebrows,
    dead bands (vertical AND horizontal — the landscape canvas is short and
    wide), per-template count budgets, wrapped command chips, and ramp
    trend-line drift.

Every measurable per-template budget lives in the module-level ``BUDGETS``
dict — the single source of truth the checks (including the injected DOM
JS) read from. Tune landscape budgets there, not inline.

Standalone CLI (self-renders via render_image's inline_assets path):

    card_lint.py --in images/<slug>.html [--type card|carousel] [--json]

Exit codes: 0 clean · 1 WARN-only · 2 any FAIL.
render_image.py runs both layers automatically on every card render
(`--no-lint` skips, `--strict` makes FAILs fatal).
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"

# ---------------------------------------------------------------------------
# BUDGETS — every measurable per-template limit, tuned for landscape 1200×675.
# The 675px canvas is SHORT: fewer stacked rows than the LinkedIn sibling's
# portrait cards, but lines run wider. DOM checks receive this dict verbatim.
# ---------------------------------------------------------------------------
BUDGETS = {
    # Press hero terminal: wider but shorter than portrait (rows × chars).
    "term": {"max_rows": 12, "max_chars": 64},
    # X carousel = a 4-image post (2–4 slides; >4 is thread-with-images).
    "carousel": {"min_slides": 2, "max_slides": 4, "max_words": 30},
    # Count budgets per template kind (canvas class → element counts).
    "howto": {"sel": ".step", "min": 3, "max": 4,
              "fix": "howto takes 3-4 steps in landscape; split into a thread-with-images"},
    "howto-stack": {"sel": ".sstep", "min": 3, "max": 3,
                    "fix": "howto-stack takes exactly 3 big-number rows in landscape"},
    "howto-grid": {"sel": ".gstep", "min": 3, "max": 4,
                   "fix": "howto-grid wants exactly 4 tiles in a row; 3 auto-spans"},
    "howto-check": {"sel": ".check", "min": 3, "max": 4,
                    "fix": "howto-check takes 3-4 rows in landscape, one-line details"},
    "flow": {"sel": ".fnode", "min": 3, "max": 5,
             "fix": "flow takes 3-5 stages; landscape reads them left-to-right"},
    # Code card line budget (warn above soft, fail above hard).
    "code": {"soft_lines": 8, "hard_lines": 10},
    # Dead-space thresholds (px). Vertical is tight on a 675px canvas;
    # horizontal is judged WARN-only (two-column layouts vary legitimately).
    "empty_band": {"warn": 100, "fail": 160},
    "empty_band_x": {"warn": 300},
    # Ramp trendline geometry: circle cy = baseline − bar height.
    "ramp": {"baseline": 498},
    # h1 wrap: landscape headlines are wide; 3 lines warns, 4 fails.
    "h1": {"warn_lines": 3, "fail_lines": 4},
}


@dataclass
class Finding:
    level: str  # "WARN" | "FAIL"
    code: str
    message: str

    def line(self) -> str:
        return f"{self.level} {self.code}: {self.message}"


# Exact strings that only exist in the shipped template scaffolding — any survivor
# means the author published placeholder copy.
PLACEHOLDER_STRINGS = (
    "Eyebrow Label",
    "One sharp headline",
    "the --actual command or config",
    "val 1",
    "Step title",
    "One-line detail",
)


def _harvest_icon_paths(assets_dir: Path = ASSETS) -> frozenset[str]:
    """Every SVG `d="..."` path shipped in the card templates — the fingerprints
    of the default example icons."""
    paths: set[str] = set()
    for tpl in sorted(assets_dir.glob("card-template-*.html")):
        paths.update(re.findall(r'\bd="([^"]+)"', tpl.read_text(encoding="utf-8")))
    return frozenset(paths)


TEMPLATE_ICON_PATHS = _harvest_icon_paths()

_TEMPLATE_NAME = re.compile(r"card-template-.*\.html$")
_SLIDE_START = re.compile(r'<div\s+class="[^"]*\bslide\b[^"]*"[^>]*>')
_TAG = re.compile(r"<[^>]+>")
_TERM_ROW = re.compile(
    r'<div\b[^>]*\bclass="[^"]*\btl\b[^"]*"[^>]*>(.*?)</div>', re.S)
# Box-drawing glyphs — a row containing any of these is part of an ASCII table.
_BOX_CHARS = set("┌┐└┘├┤┬┴┼─│")


def _is_template_file(path: Path | str | None) -> bool:
    return path is not None and bool(_TEMPLATE_NAME.fullmatch(Path(path).name))


def static_checks(html: str, path: Path | str | None = None) -> list[Finding]:
    """Browser-free checks on the raw authored HTML (see module docstring)."""
    findings: list[Finding] = []
    if not _is_template_file(path):
        has_default_icon = any(d in html for d in TEMPLATE_ICON_PATHS)
        has_icons_comment = "ICONS:" in html
        if has_default_icon and has_icons_comment:
            findings.append(Finding(
                "FAIL", "default-icon",
                "a template default icon path is still present AND the ICONS: "
                "scaffolding comment survives — replace every icon with a topic "
                "icon from assets/card-icons.md",
            ))
        elif has_default_icon:
            findings.append(Finding(
                "WARN", "default-icon",
                "an icon path identical to a template default is present — confirm "
                "it genuinely fits the topic (assets/card-icons.md has alternatives)",
            ))
        if has_icons_comment:
            findings.append(Finding(
                "FAIL", "icons-comment",
                'the "ICONS:" scaffolding comment survives in an authored file — '
                "replace the icons, then delete the comment",
            ))
        for s in PLACEHOLDER_STRINGS:
            if s in html:
                findings.append(Finding(
                    "FAIL", "placeholder-copy",
                    f"template placeholder copy survives: {s!r}",
                ))
        findings.extend(_term_checks(html))
    findings.extend(_carousel_checks(html))
    return findings


def _term_checks(html: str) -> list[Finding]:
    """Fidelity checks on Press `.term` rows (`<div class="tl …">`): box-drawing
    table rows must align to one shared width, and the whole panel must stay
    inside the hero-terminal budget (BUDGETS['term'])."""
    findings: list[Finding] = []
    rows = [
        html_mod.unescape(_TAG.sub("", m.group(1)))
        for m in _TERM_ROW.finditer(html)
    ]
    if not rows:
        return findings

    # Alignment is judged per table: a table is a contiguous run of box-drawing
    # rows, so two separate tables (or two .term panels) may differ in width.
    runs: list[list[tuple[int, str]]] = []
    for i, r in enumerate(rows, start=1):
        if _BOX_CHARS & set(r):
            if runs and runs[-1][-1][0] == i - 1:
                runs[-1].append((i, r))
            else:
                runs.append([(i, r)])
    for run in runs:
        widths = {len(r.rstrip()) for _, r in run}
        if len(widths) > 1:
            detail = ", ".join(
                f"row {i}: {len(r.rstrip())} chars" for i, r in run
            )
            findings.append(Finding(
                "FAIL", "term-misaligned",
                "the terminal's box-drawing table rows have unequal widths ("
                f"{detail}) — a real CLI table aligns every border and cell; "
                "pad each row to one shared width",
            ))

    max_rows = BUDGETS["term"]["max_rows"]
    max_chars = BUDGETS["term"]["max_chars"]
    if len(rows) > max_rows:
        findings.append(Finding(
            "WARN", "term-rows",
            f"{len(rows)} .tl rows — the landscape hero-terminal budget is "
            f"≤{max_rows}; cut whole rows (keep the prompt, tool-call line, "
            "table, verdict)",
        ))
    widest = max(rows, key=lambda r: len(r.rstrip()))
    if len(widest.rstrip()) > max_chars:
        findings.append(Finding(
            "WARN", "term-width",
            f"a .tl row is {len(widest.rstrip())} chars (>{max_chars}) — "
            "it will shrink or clip at feed size; tighten the widest row",
        ))
    return findings


def _strip_chrome(segment: str) -> str:
    """Remove the repeated slide chrome (eyebrow/footer/pageno/swipe/rail and
    comments) so the word count measures the slide's actual body copy."""
    seg = re.sub(r"<!--.*?-->", " ", segment, flags=re.S)
    seg = re.sub(r'<span class="pageno">.*?</span>', " ", seg, flags=re.S)
    seg = re.sub(r'<span class="swipe">.*?</span>', " ", seg, flags=re.S)
    seg = re.sub(r'<div class="eyebrow">.*?</div>', " ", seg, flags=re.S)
    seg = re.sub(r'<div class="footer[^"]*">.*?</div>', " ", seg, flags=re.S)
    seg = re.sub(r'<div class="rail">.*?</div>', " ", seg, flags=re.S)
    return seg


def _carousel_checks(html: str) -> list[Finding]:
    """Slide-counter sync for standalone `class="card slide"` carousel HTML."""
    findings: list[Finding] = []
    starts = list(_SLIDE_START.finditer(html))
    if not starts:
        return findings
    n = len(starts)
    lo = BUDGETS["carousel"]["min_slides"]
    hi = BUDGETS["carousel"]["max_slides"]
    if not lo <= n <= hi:
        findings.append(Finding(
            "WARN", "slide-count",
            f"{n} slides — an X carousel is a 4-image post ({lo}–{hi} slides); "
            ">4 only as thread-with-images (render with --allow-many)",
        ))
    for k, m in enumerate(starts, start=1):
        end = starts[k].start() if k < n else len(html)
        segment = html[m.start():end]
        tag = m.group(0)
        mi = re.search(r"--i:\s*(\d+)", tag)
        mn = re.search(r"--n:\s*(\d+)", tag)
        i_val = int(mi.group(1)) if mi else None
        n_val = int(mn.group(1)) if mn else None
        if n_val != n:
            findings.append(Finding(
                "FAIL", "carousel-sync",
                f"slide {k}: --n:{n_val} but the file has {n} slides",
            ))
        if i_val != k:
            findings.append(Finding(
                "FAIL", "carousel-sync",
                f"slide {k}: --i:{i_val} — the --i values must run 1..{n} in order",
            ))
        pm = re.search(r'<span class="pageno">(.*?)</span>', segment, flags=re.S)
        if pm:
            pageno = " ".join(_TAG.sub("", pm.group(1)).split())
            want = f"{k:02d} / {n:02d}"
            if pageno != want:
                findings.append(Finding(
                    "FAIL", "carousel-sync",
                    f'slide {k}: pageno text "{pageno}" — must read "{want}" '
                    "(the counter is literal text, keep it in sync by hand)",
                ))
        words = len(_TAG.sub(" ", _strip_chrome(segment)).split())
        if words > BUDGETS["carousel"]["max_words"]:
            findings.append(Finding(
                "WARN", "slide-words",
                f"slide {k}: ~{words} words — one idea, "
                f"≤{BUDGETS['carousel']['max_words']} words per slide",
            ))
    return findings


# ---------------------------------------------------------------------------
# DOM checks — evaluated inside the already-loaded page. The JS receives the
# BUDGETS dict as its argument so every threshold has one source of truth.
# ---------------------------------------------------------------------------
LINT_JS = r"""
(B) => {
  const findings = [];
  const push = (level, code, message) => findings.push({ level, code, message });
  const canvas = document.getElementById('canvas');
  if (!canvas) { push('FAIL', 'no-canvas', 'no #canvas element on the page'); return findings; }
  const cs = getComputedStyle(canvas);
  const cRect = canvas.getBoundingClientRect();
  const cls = Array.from(canvas.classList);
  const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const short = el => { const t = txt(el); return t.length > 40 ? t.slice(0, 40) + '…' : t; };
  const name = el => {
    const c = el.getAttribute && el.getAttribute('class');
    return '<' + el.tagName.toLowerCase() + (c ? ' class="' + c + '"' : '') + '>';
  };
  const visible = el => {
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) !== 0;
  };

  // 1. clip-overflow — visible content escaping the canvas box.
  const offenders = [];
  for (const el of canvas.querySelectorAll('*')) {
    if (el.ownerSVGElement) continue;              // judge the <svg> root, not its internals
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const isGfx = tag === 'svg' || tag === 'img';
    if (!isGfx && !txt(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom > cRect.bottom + 2 || r.right > cRect.right + 2) offenders.push([el, r]);
  }
  for (const [el, r] of offenders) {
    if (offenders.some(([o]) => o !== el && el.contains(o))) continue;   // deepest only
    push('FAIL', 'clip-overflow',
      name(el) + ' "' + short(el) + '" reaches bottom ' + Math.round(r.bottom) + 'px / right ' +
      Math.round(r.right) + 'px but the canvas ends at bottom ' + Math.round(cRect.bottom) +
      'px / right ' + Math.round(cRect.right) + 'px — it is clipped off the card');
  }
  if (canvas.scrollHeight > canvas.clientHeight + 2)
    push('FAIL', 'clip-overflow',
      '#canvas scrolls: scrollHeight ' + canvas.scrollHeight + 'px > clientHeight ' +
      canvas.clientHeight + 'px — the content is taller than the frame');

  // 2. ellipsis-fired — truncation actually happened somewhere.
  for (const el of canvas.querySelectorAll('*')) {
    if (!visible(el)) continue;
    if (getComputedStyle(el).textOverflow !== 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 1)
      push('FAIL', 'ellipsis-fired',
        name(el) + ' is ellipsized (' + el.scrollWidth + 'px of text in ' + el.clientWidth +
        'px): full text "' + txt(el) + '"');
  }

  // 3. eyebrow-wrap FAIL / h1-wrap WARN/FAIL per BUDGETS.h1.
  for (const el of canvas.querySelectorAll('.eyebrow')) {
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const h = el.getBoundingClientRect().height;
    if (h > 1.5 * fs * 1.2)
      push('FAIL', 'eyebrow-wrap',
        '.eyebrow wraps (' + Math.round(h) + 'px tall): "' + short(el) +
        '" — keep it one line, ≤24 chars');
  }
  for (const el of canvas.querySelectorAll('h1')) {
    if (!visible(el)) continue;
    const st = getComputedStyle(el);
    const fs = parseFloat(st.fontSize);
    let lh = parseFloat(st.lineHeight);
    if (!isFinite(lh) || lh <= 0) lh = fs * 1.2;
    const lines = Math.round(el.getBoundingClientRect().height / lh);
    if (lines >= B.h1.fail_lines)
      push('FAIL', 'h1-wrap', 'h1 renders as ' + lines + ' lines: "' + short(el) +
        '" — cut to ≤2 lines (landscape lines run wide)');
    else if (lines >= B.h1.warn_lines)
      push('WARN', 'h1-wrap', 'h1 renders as ' + lines + ' lines: "' + short(el) +
        '" — 2 lines reads stronger');
  }

  // 4. empty-band — dead space between the canvas's flow children.
  //    Vertical thresholds are tight (675px canvas); horizontal is WARN-only.
  const kids = Array.from(canvas.children)
    .filter(el => {
      if (!visible(el)) return false;
      const p = getComputedStyle(el).position;
      return p !== 'absolute' && p !== 'fixed';
    })
    .map(el => [el, el.getBoundingClientRect()])
    .filter(([, r]) => r.height > 0)
    .sort((a, b) => a[1].top - b[1].top);
  const band = (gap, where) => {
    if (gap > B.empty_band.fail)
      push('FAIL', 'empty-band', Math.round(gap) + 'px of dead vertical space ' + where +
        ' — the content floats in whitespace; scale it up or add substance');
    else if (gap > B.empty_band.warn)
      push('WARN', 'empty-band', Math.round(gap) + 'px vertical gap ' + where);
  };
  for (let i = 1; i < kids.length; i++)
    band(kids[i][1].top - kids[i - 1][1].bottom,
      'between ' + name(kids[i - 1][0]) + ' and ' + name(kids[i][0]));
  if (kids.length) {
    const contentBottom = cRect.top + canvas.clientTop + canvas.clientHeight - parseFloat(cs.paddingBottom);
    band(contentBottom - kids[kids.length - 1][1].bottom, 'below the last block');
    // Horizontal dead band: the widest flow child vs the content right edge.
    const contentRight = cRect.left + canvas.clientLeft + canvas.clientWidth - parseFloat(cs.paddingRight);
    const maxRight = Math.max(...kids.map(([, r]) => r.right));
    const xGap = contentRight - maxRight;
    if (xGap > B.empty_band_x.warn)
      push('WARN', 'empty-band-x', Math.round(xGap) + 'px of dead horizontal space right of ' +
        'the widest block — landscape wants hero-left/support-right, not a thin column');
  }

  // 5. count-budget — per-template element budgets (from BUDGETS).
  const count = sel => canvas.querySelectorAll(sel).length;
  for (const kind of ['howto', 'howto-stack', 'howto-grid', 'howto-check', 'flow']) {
    if (!cls.includes(kind)) continue;
    const b = B[kind];
    const n = count(b.sel);
    if (n < b.min || n > b.max)
      push('FAIL', 'count-budget', n + ' × ' + b.sel + ' in ' + kind + ' — ' + b.fix);
    if (kind === 'howto-grid' && n === 3)
      push('WARN', 'count-budget',
        '3 tiles in howto-grid: the third spans (automatic) — prefer exactly 4');
  }
  if (cls.includes('code')) {
    const n = count('.line');
    if (n > B.code.hard_lines)
      push('FAIL', 'count-budget', n + ' code lines — hard cap ' + B.code.hard_lines +
        ' on the landscape canvas; cut to ≤' + B.code.soft_lines);
    else if (n > B.code.soft_lines)
      push('WARN', 'count-budget', n + ' code lines — keep ≤' + B.code.soft_lines +
        ' for feed legibility');
  }
  if (cls.includes('matrix')) {
    const grid = canvas.querySelector('.grid');
    const heads = count('.col-h');
    if (grid && heads) {
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      if (heads + 1 !== tracks)
        push('FAIL', 'matrix-cols',
          heads + ' option columns but the grid lays out ' + tracks + ' tracks — ' +
          heads + ' options need class "grid cols' + heads + '" (the default grid is 3 options)');
    }
  }

  // 6. chip-wrap WARN — a .cmd that wraps past one line.
  for (const el of canvas.querySelectorAll('.cmd')) {
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (el.getBoundingClientRect().height > 1.7 * fs * 1.3)
      push('WARN', 'chip-wrap', '.cmd wraps to two+ lines: "' + txt(el) +
        '" — a one-line command reads best');
  }

  // 7. ramp-trendline WARN — circle cy must track baseline − barHeight.
  if (cls.includes('ramp')) {
    const circles = canvas.querySelectorAll('.trendline circle');
    const bars = canvas.querySelectorAll('.step .bar');
    const k = Math.min(circles.length, bars.length);
    for (let i = 0; i < k; i++) {
      const cy = parseFloat(circles[i].getAttribute('cy'));
      const want = B.ramp.baseline - bars[i].clientHeight;
      if (Math.abs(cy - want) > 4)
        push('WARN', 'ramp-trendline',
          'trendline circle ' + (i + 1) + ' cy=' + cy + ' but bar height ' +
          bars[i].clientHeight + 'px implies cy=' + want +
          ' (cy = ' + B.ramp.baseline + ' − barHeight)');
    }
  }

  return findings;
}
"""


def lint_page(page) -> list[Finding]:
    """Run the DOM checks on an already-loaded Playwright page."""
    raw = page.evaluate(LINT_JS, BUDGETS)
    return [Finding(f["level"], f["code"], f["message"]) for f in raw]


def dom_lint_html(raw_html: str) -> list[Finding]:
    """Self-render `raw_html` (inlining brand CSS via render_image) and run the
    DOM checks. Used by the standalone CLI for single cards."""
    import render_image

    html = render_image.inline_assets(raw_html)
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError:
        sys.exit(f"ERROR: playwright not installed.\n{render_image.INSTALL_HINT}")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 675})
        page.set_content(html, wait_until="load")
        page.wait_for_selector("#canvas", timeout=5000)
        findings = lint_page(page)
        browser.close()
    return findings


def exit_code(findings: list[Finding]) -> int:
    if any(f.level == "FAIL" for f in findings):
        return 2
    return 1 if findings else 0


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="src", required=True, help="Authored card/carousel .html")
    ap.add_argument("--type", choices=["card", "carousel"], default="card",
                    help="carousel = static slide-sync checks only (no browser)")
    ap.add_argument("--json", action="store_true", help="Emit findings as JSON")
    args = ap.parse_args(argv)

    src = Path(args.src)
    if not src.is_absolute():
        src = REPO / src
    if not src.exists():
        sys.exit(f"ERROR: source not found: {src}")

    raw = src.read_text(encoding="utf-8")
    findings = static_checks(raw, src)
    if args.type == "card":
        findings += dom_lint_html(raw)

    if args.json:
        print(json.dumps([f.__dict__ for f in findings], indent=2))
    else:
        for f in findings:
            print(f.line())
    sys.exit(exit_code(findings))


if __name__ == "__main__":
    main()
