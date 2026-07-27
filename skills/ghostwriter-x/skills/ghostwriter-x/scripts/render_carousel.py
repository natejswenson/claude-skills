#!/usr/bin/env python3
"""Render a multi-image X carousel to per-slide 16:9 PNGs.

X has no PDF documents: a "carousel" is a 4-image post (X shows up to 4 images
in a grid) or a thread with one image per tweet. Author it as ONE HTML file with
several `.slide.card` sections (see assets/card-template-carousel.html), all
styled by assets/diagram.css. This script screenshots each `.slide` to
images/<slug>-NN.png (1200×675 @2x) and prints the exact `x_post.py --image`
flags to publish with.

More than 4 slides is refused unless --allow-many (the thread-with-images case,
where each tweet carries one slide).

Needs the same Playwright + Chromium as render_image.py:
    python3 -m venv .venv
    .venv/bin/pip install playwright
    .venv/bin/playwright install chromium

Usage:
    .venv/bin/python scripts/render_carousel.py --in images/foo-carousel.html
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

import card_lint

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
# Personal brand guide: shared home dir first (same location Claude Code and Claude Desktop
# both read), then the repo copy, then the shipped default on a fresh clone.
HOME_CSS = Path.home() / ".claude" / "ghostwriter-x" / "assets" / "diagram.css"
CSS = ASSETS / "diagram.css"
CSS_EXAMPLE = ASSETS / "diagram.css.example"

SLIDE_W = 1200  # each slide is a fixed landscape 16:9 page (1200x675) —
SLIDE_H = 675   # X's native timeline crop

INSTALL_HINT = (
    "Rendering needs Playwright + Chromium (the optional diagram feature).\n"
    "  python3 -m venv .venv\n"
    "  .venv/bin/pip install playwright\n"
    "  .venv/bin/playwright install chromium\n"
    "Then run this script with .venv/bin/python."
)


def brand_css_path() -> Path:
    if HOME_CSS.exists():
        return HOME_CSS
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


def slide_stem(src: Path) -> Path:
    """images/<slug>-carousel.html -> images/<slug>; plain names keep their stem."""
    stem = src.with_suffix("")
    if stem.name.endswith("-carousel"):
        stem = stem.with_name(stem.name[: -len("-carousel")])
    return stem


def publish_hint(stem: Path, count: int) -> str:
    """The exact flags to attach every slide to tweet 1 (≤4) or one per tweet."""
    if count <= card_lint.BUDGETS["carousel"]["max_slides"]:
        flags = " ".join(
            f"--image images/{stem.name}-{i + 1:02d}.png" for i in range(count)
        )
    else:  # thread-with-images: slide N rides tweet N
        flags = " ".join(
            f"--image {i + 1}:images/{stem.name}-{i + 1:02d}.png" for i in range(count)
        )
    return (
        f"python3 scripts/x_post.py --file drafts/<slug>.md {flags}"
        " (add a matching --alt per image)"
    )


def render(html: str, stem: Path, max_slides: int, allow_many: bool) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ModuleNotFoundError:
        sys.exit(f"ERROR: playwright not installed.\n{INSTALL_HINT}")

    stem.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                viewport={"width": SLIDE_W, "height": SLIDE_H},
                device_scale_factor=2,
            )
            page.set_content(html, wait_until="load")
            slides = page.locator(".slide")
            count = slides.count()
            if count == 0:
                browser.close()
                sys.exit("ERROR: no .slide elements found. Use the carousel template.")
            if count > max_slides and not allow_many:
                browser.close()
                sys.exit(
                    f"ERROR: {count} slides, but an X post carries at most "
                    f"{max_slides} images. Either cut to {max_slides} slides "
                    "(cover → point → point → recap) or re-run with --allow-many "
                    "to render a thread-with-images set (one slide per tweet)."
                )

            for i in range(count):
                out_png = Path(f"{stem}-{i + 1:02d}.png")
                slides.nth(i).screenshot(path=str(out_png))
                print(f"  slide {i + 1}/{count} -> {out_png.name}")
            browser.close()
            return count
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            sys.exit(f"ERROR: Chromium not installed.\n{INSTALL_HINT}")
        sys.exit(f"ERROR while rendering: {msg}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="src", required=True,
                    help="Carousel .html (multiple .slide sections)")
    ap.add_argument("--allow-many", action="store_true",
                    help="Permit >4 slides (thread-with-images: one slide per tweet).")
    ap.add_argument("--no-open", action="store_true",
                    help="Don't open the first PNG after rendering.")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_absolute():
        src = REPO / src
    if not src.exists():
        sys.exit(f"ERROR: source not found: {src}")

    stem = slide_stem(src)
    max_slides = card_lint.BUDGETS["carousel"]["max_slides"]
    html = inline_css(src.read_text(encoding="utf-8"))
    count = render(html, stem, max_slides, args.allow_many)
    first = Path(f"{stem}-01.png")
    if not args.no_open:
        open_in_viewer(first)
    print(
        f"Rendered {count} slide PNGs -> {stem}-NN.png"
        f"{'' if args.no_open else ' — opened the first'}"
    )
    print("Publish with:")
    print(f"  {publish_hint(stem, count)}")


if __name__ == "__main__":
    main()
