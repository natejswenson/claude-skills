#!/usr/bin/env python3
"""Render a multi-slide LinkedIn carousel to preview PNGs + a single PDF document.

A carousel is the highest-reach native LinkedIn format. Author it as ONE HTML file
with several `.slide.card` sections (see assets/card-template-carousel.html), all
styled by assets/diagram.css. This script:
  * screenshots each `.slide` to images/<slug>-NN.png (for the user to approve), and
  * stitches those slides into images/<slug>.pdf — the file you post as a document.

Needs the same Playwright + Chromium as render_image.py:
    python3 -m venv .venv
    .venv/bin/pip install playwright
    .venv/bin/playwright install chromium

Usage:
    .venv/bin/python scripts/render_carousel.py --in images/foo.html --out images/foo.pdf
"""
from __future__ import annotations

import argparse
import base64
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
CSS = ASSETS / "diagram.css"
CSS_EXAMPLE = ASSETS / "diagram.css.example"

SLIDE_PX = 1200  # each slide is a fixed 1200x1200 page

INSTALL_HINT = (
    "Rendering needs Playwright + Chromium (the optional diagram feature).\n"
    "  python3 -m venv .venv\n"
    "  .venv/bin/pip install playwright\n"
    "  .venv/bin/playwright install chromium\n"
    "Then run this script with .venv/bin/python."
)


def brand_css_path() -> Path:
    return CSS if CSS.exists() else CSS_EXAMPLE


def inline_css(html: str) -> str:
    """Inline diagram.css so the page renders identically regardless of cwd."""
    css = brand_css_path().read_text(encoding="utf-8")
    return re.sub(
        r'<link[^>]*href="[^"]*diagram\.css"[^>]*>',
        lambda _m: f"<style>\n{css}\n</style>",
        html,
    )


def open_in_viewer(path: Path) -> None:
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=False)
        elif sys.platform.startswith("win"):
            subprocess.run(["cmd", "/c", "start", "", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except Exception:
        pass


def pdf_from_pngs(page, png_bytes: list[bytes], pdf_out: Path) -> None:
    """Stitch the slide PNGs into one square-page PDF (one slide per page)."""
    imgs = "".join(
        f'<img src="data:image/png;base64,{base64.b64encode(b).decode()}" />'
        for b in png_bytes
    )
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
      @page {{ size: {SLIDE_PX}px {SLIDE_PX}px; margin: 0; }}
      html, body {{ margin: 0; padding: 0; }}
      img {{ display: block; width: {SLIDE_PX}px; height: {SLIDE_PX}px; }}
      img {{ break-after: page; page-break-after: always; }}
      img:last-child {{ break-after: auto; page-break-after: auto; }}
    </style></head><body>{imgs}</body></html>"""
    page.set_content(html, wait_until="load")
    page.pdf(
        path=str(pdf_out),
        width=f"{SLIDE_PX}px",
        height=f"{SLIDE_PX}px",
        print_background=True,
        margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
    )


def render(html: str, pdf_out: Path) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError:
        sys.exit(f"ERROR: playwright not installed.\n{INSTALL_HINT}")

    pdf_out.parent.mkdir(parents=True, exist_ok=True)
    stem = pdf_out.with_suffix("")  # images/<slug>
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                viewport={"width": SLIDE_PX, "height": SLIDE_PX},
                device_scale_factor=2,
            )
            page.set_content(html, wait_until="load")
            slides = page.locator(".slide")
            count = slides.count()
            if count == 0:
                browser.close()
                sys.exit("ERROR: no .slide elements found. Use the carousel template.")

            png_bytes: list[bytes] = []
            for i in range(count):
                out_png = Path(f"{stem}-{i + 1:02d}.png")
                data = slides.nth(i).screenshot(path=str(out_png))
                png_bytes.append(data)
                print(f"  slide {i + 1}/{count} -> {out_png.name}")

            # stitch the slides into one PDF on a fresh page
            pdf_page = browser.new_page()
            pdf_from_pngs(pdf_page, png_bytes, pdf_out)
            browser.close()
            return count
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            sys.exit(f"ERROR: Chromium not installed.\n{INSTALL_HINT}")
        sys.exit(f"ERROR while rendering: {msg}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="src", required=True, help="Carousel .html (multiple .slide sections)")
    ap.add_argument("--out", required=True, help="Output .pdf path (under images/)")
    ap.add_argument("--no-open", action="store_true", help="Don't open the PDF after rendering.")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_absolute():
        src = REPO / src
    if not src.exists():
        sys.exit(f"ERROR: source not found: {src}")
    pdf_out = Path(args.out)
    if not pdf_out.is_absolute():
        pdf_out = REPO / pdf_out
    if pdf_out.suffix.lower() != ".pdf":
        sys.exit("ERROR: --out must be a .pdf path")

    html = inline_css(src.read_text(encoding="utf-8"))
    count = render(html, pdf_out)
    if not args.no_open:
        open_in_viewer(pdf_out)
    print(
        f"Rendered {count}-slide carousel -> {pdf_out}"
        f" (+ {count} preview PNGs){'' if args.no_open else ' — opened the PDF'}"
    )


if __name__ == "__main__":
    main()
