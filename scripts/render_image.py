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
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
CSS = ASSETS / "diagram.css"
MERMAID_JS = ASSETS / "vendor" / "mermaid.min.js"
MERMAID_TEMPLATE = ASSETS / "mermaid-template.html"

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
    css = CSS.read_text(encoding="utf-8")
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


def render(kind: str, html: str, out: Path, width: int, height: int) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError:
        sys.exit(f"ERROR: playwright not installed.\n{INSTALL_HINT}")

    out.parent.mkdir(parents=True, exist_ok=True)
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
            page.locator("#canvas").screenshot(path=str(out))
            browser.close()
    except Exception as e:  # noqa: BLE001 — give a useful message, not a trace
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            sys.exit(f"ERROR: Chromium not installed.\n{INSTALL_HINT}")
        sys.exit(f"ERROR while rendering: {msg}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--type", required=True, choices=["mermaid", "card"])
    ap.add_argument("--in", dest="src", required=True, help="Source .mmd or .html")
    ap.add_argument("--out", required=True, help="Output .png path (under images/)")
    ap.add_argument(
        "--size",
        default="1280x1280",
        help="Viewport WxH (cards are fixed 1200x1200; mermaid auto-fits). Default 1280x1280.",
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
    render(args.type, html, out, w, h)
    print(f"Rendered {args.type} -> {out}  (viewport {w}x{h} @2x)")


if __name__ == "__main__":
    main()
