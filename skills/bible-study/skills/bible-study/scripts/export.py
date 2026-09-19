#!/usr/bin/env python3
"""Export locally rendered study HTML, refusing overflow rather than shrinking type."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def export(source, out):
    source = Path(source).resolve()
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 816, "height": 1056}, device_scale_factor=2)
        # Self-contained artifact: no remote resources may load during export.
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith("file:") else route.abort())
        page.goto(source.as_uri())
        page.emulate_media(media="print")
        page.evaluate("document.fonts.ready")
        bounds = page.evaluate("""() => {
          const sheet=document.querySelector('.sheet');
          if (!sheet) throw new Error('No study sheet');
          const r=sheet.getBoundingClientRect();
          const bad=[...sheet.querySelectorAll('*')].filter(el=>{
            const b=el.getBoundingClientRect();
            return b.right>r.right+1 || b.bottom>r.bottom-10 || b.left<r.left-1 || el.scrollWidth>el.clientWidth+1;
          });
          return {width:r.width,height:r.height,overflow:bad.map(x=>x.tagName+' '+x.textContent.slice(0,50))};
        }""")
        if bounds["overflow"] or bounds["height"] > 1056:
            browser.close()
            raise ValueError("Study overflows one page; shorten content or revise layout: " + str(bounds))
        page.pdf(path=str(out / "study.pdf"), format="Letter", print_background=True, prefer_css_page_size=True)
        page.screenshot(path=str(out / "study.png"), full_page=True)
        browser.close()
    (out / "layout-check.json").write_text(json.dumps(bounds, indent=2)+"\n")
    print("PDF and PNG exported; inspect the rendered PDF and verify one page before delivery.")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True)
    parser.add_argument("--out", required=True)
    args=parser.parse_args()
    export(args.file,args.out)
