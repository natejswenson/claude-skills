#!/usr/bin/env python3
"""Render a LinkedIn visual (Mermaid diagram or HTML card) to a high-DPI PNG.

This is the OPTIONAL diagram feature. It needs Playwright + Chromium:

    python3 -m venv .venv
    .venv/bin/pip install playwright
    .venv/bin/playwright install chromium

Then run it with the venv's Python:

    .venv/bin/python scripts/render_image.py --type mermaid \\
        --in images/foo.mmd --out images/foo.png
    .venv/bin/python scripts/render_image.py --type card \\
        --in images/foo.html --out images/foo.png

Mermaid sources are plain `.mmd` text. Cards are HTML files based on
`assets/card-template.html`. Both pull their styling from `assets/diagram.css`,
which this script inlines so the page renders the same no matter where it lives.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


def open_in_viewer(path: Path) -> None:
    """Pop the rendered PNG open in the OS image viewer so it's actually seen.
    Best-effort and cross-platform; never fails the render if it can't open."""
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=False)
        elif sys.platform.startswith("win"):
            subprocess.run(["cmd", "/c", "start", "", str(path)], check=False)
        else:  # linux / other
            subprocess.run(["xdg-open", str(path)], check=False)
    except Exception:
        pass  # opening is a convenience, not a requirement

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
# Personal brand guide: shared home dir first (same location Claude Code and Claude Desktop
# both read), then the repo copy, then the shipped default on a fresh clone.
HOME_CSS = Path.home() / ".claude" / "ghostwriter" / "assets" / "diagram.css"
CSS = ASSETS / "diagram.css"
CSS_EXAMPLE = ASSETS / "diagram.css.example"
MERMAID_JS = ASSETS / "vendor" / "mermaid.min.js"
MERMAID_TEMPLATE = ASSETS / "mermaid-template.html"


def brand_css_path() -> Path:
    if HOME_CSS.exists():
        return HOME_CSS
    return CSS if CSS.exists() else CSS_EXAMPLE

INSTALL_HINT = (
    "Rendering needs Playwright + Chromium (the optional diagram feature).\n"
    "  python3 -m venv .venv\n"
    "  .venv/bin/pip install playwright\n"
    "  .venv/bin/playwright install chromium\n"
    "Then run this script with .venv/bin/python."
)


def inline_assets(html: str) -> str:
    """Replace the stylesheet <link> and mermaid <script src> with inline copies,
    so the page is self-contained and path-independent."""
    # Use function replacements so backslashes in CSS/JS aren't treated as
    # regex escape sequences in the replacement string.
    css = brand_css_path().read_text(encoding="utf-8")
    html = re.sub(
        r'<link[^>]*href="[^"]*diagram\.css"[^>]*>',
        lambda _m: f"<style>\n{css}\n</style>",
        html,
    )
    if 'vendor/mermaid.min.js' in html:
        js = MERMAID_JS.read_text(encoding="utf-8")
        html = re.sub(
            r'<script[^>]*src="[^"]*vendor/mermaid\.min\.js"[^>]*>\s*</script>',
            lambda _m: f"<script>\n{js}\n</script>",
            html,
        )
    return html


def build_html(kind: str, src: Path) -> str:
    if kind == "mermaid":
        diagram = src.read_text(encoding="utf-8").strip()
        html = MERMAID_TEMPLATE.read_text(encoding="utf-8")
        html = html.replace("%%DIAGRAM%%", diagram)
    else:  # card
        html = src.read_text(encoding="utf-8")
    return inline_assets(html)


def render(kind: str, html: str, out: Path, width: int, height: int, lint: bool = False):
    """Render to `out`. When `lint` is true (cards only), run the card_lint DOM
    checks on the live page before the screenshot and return the findings —
    a lint bug can never kill a render (wrapped, non-fatal)."""
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError:
        sys.exit(f"ERROR: playwright not installed.\n{INSTALL_HINT}")

    out.parent.mkdir(parents=True, exist_ok=True)
    findings: list = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                viewport={"width": width, "height": height},
                device_scale_factor=2,
            )
            page.set_content(html, wait_until="load")
            if kind == "mermaid":
                # Wait for mermaid.run() to finish (or surface its error).
                page.wait_for_function(
                    "window.__renderDone === true || window.__renderError",
                    timeout=15000,
                )
                err = page.evaluate("window.__renderError || null")
                if err:
                    browser.close()
                    sys.exit(f"ERROR: mermaid failed to render:\n{err}")
            page.wait_for_selector("#canvas", timeout=5000)
            if lint and kind == "card":
                try:
                    import card_lint
                    findings = card_lint.lint_page(page)
                except Exception as le:  # noqa: BLE001 — lint must never kill a render
                    print(f"LINT ERROR (non-fatal): {le}", file=sys.stderr)
            page.locator("#canvas").screenshot(path=str(out))
            browser.close()
    except Exception as e:  # noqa: BLE001 — give a useful message, not a trace
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            sys.exit(f"ERROR: Chromium not installed.\n{INSTALL_HINT}")
        sys.exit(f"ERROR while rendering: {msg}")
    return findings


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--type", required=True, choices=["mermaid", "card"])
    ap.add_argument("--in", dest="src", required=True, help="Source .mmd or .html")
    ap.add_argument("--out", required=True, help="Output .png path (under images/)")
    ap.add_argument(
        "--size",
        default="1200x1500",
        help="Viewport WxH hint only — the screenshot crops to #canvas, which sizes "
             "itself from CSS. Default 1200x1500.",
    )
    ap.add_argument(
        "--no-open",
        action="store_true",
        help="Don't pop the PNG open in the image viewer after rendering (default: open it).",
    )
    ap.add_argument(
        "--no-lint",
        action="store_true",
        help="Skip the card layout/content lint (cards are linted by default; "
             "findings go to stderr and never change the exit code).",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Exit 2 if the lint reports any FAIL (use for pre-publish renders).",
    )
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_absolute():
        src = REPO / src
    if not src.exists():
        sys.exit(f"ERROR: source not found: {src}")
    out = Path(args.out)
    if not out.is_absolute():
        out = REPO / out

    try:
        w, h = (int(x) for x in args.size.lower().split("x"))
    except ValueError:
        sys.exit(f"ERROR: --size must look like 1200x1200, got {args.size!r}")

    html = build_html(args.type, src)
    lint_on = args.type == "card" and not args.no_lint
    findings = render(args.type, html, out, w, h, lint_on) or []
    if lint_on:
        try:
            import card_lint
            findings = card_lint.static_checks(
                src.read_text(encoding="utf-8"), src
            ) + list(findings)
        except Exception as e:  # noqa: BLE001 — lint must never kill a render
            print(f"LINT ERROR (non-fatal): {e}", file=sys.stderr)
    if not args.no_open:
        open_in_viewer(out)
    print(f"Rendered {args.type} -> {out}  (viewport {w}x{h} @2x){'' if args.no_open else ' — opened in viewer'}")
    for f in findings:
        print(f"{f.level} {f.code}: {f.message}", file=sys.stderr)
    if args.strict and any(f.level == "FAIL" for f in findings):
        sys.exit(2)


if __name__ == "__main__":
    main()
