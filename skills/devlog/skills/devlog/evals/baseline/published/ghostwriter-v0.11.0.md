---
title: "Catching layout bugs before your eyes do: a render-time QA gate for generated visuals"
date: 2026-07-18
project: ghostwriter
version: v0.11.0
tags: [playwright, css, has-selector, visual-regression-testing, dom-testing, browser-automation, generative-content, layout-qa]
summary: "How to measure a rendered HTML page for overflow and truncation before a human ever sees it, and the CSS trick that lets one layout adapt itself to however much content lands in it."
---

## Shipped

I maintain a skill that turns a handful of bullet points into a LinkedIn-ready image: an HTML/CSS template gets filled in and rendered to a PNG through a headless browser. The same release also added a publish log and a self-repairing scheduler for a separate part of that skill, but the fix worth teaching is what happened to the card renderer. An 11-agent audit across all 13 card templates at sparse, typical, and stress content volumes turned up 40 first-render defects, 21 of them severe: clipped headlines, ellipses firing where nobody wanted truncation, dead bands of empty space. The root cause was simple: every template had been eyeballed with one content shape in mind, and nothing ever measured what rendered. The fix was a lint that runs at render time and asserts on the live DOM, paired with CSS that adapts a layout's proportions to whatever content count it's actually carrying. That combination is the technique this post walks through, generalized so it works on any HTML-to-image pipeline, not just mine.

## Why reviewing the template isn't enough

A card template looks fine in the editor because you're reading markup, not a render. The moment real content lands in it, the browser does layout math you didn't picture: a 40-character title becomes 60 characters and now it wraps to a third line, a 3-step list becomes a 7-step list and now something is 30 pixels below the fold. Functional and unit tests don't see any of this, because they check behavior, not what a browser painted onto a page ([Percy](https://percy.io/blog/visual-regression-testing/)). If nothing measures the rendered box model, a broken card reaches a human for the first time when it's already about to ship.

The fix is to treat the render itself as a test subject: load the real page in a real browser, measure the elements that matter, and fail loudly before a screenshot goes anywhere.

## Build a card that has to survive variable content

Here's a stripped-down version of the pattern (not the production template, just the shape of it): a fixed-size frame holding a variable number of "step" blocks, each with a title and a detail line.

```css
/* style.css */
#canvas {
  width: 800px;
  height: 500px;
  padding: 40px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
  background: #10141c;
  font-family: -apple-system, sans-serif;
  overflow: hidden; /* content that doesn't fit gets clipped, not reflowed */
}
.step { display: flex; flex-direction: column; gap: 4px; }
.step .title {
  color: #fff;
  font-size: 32px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.step .detail { color: #9aa4b2; font-size: 20px; }
```

```python
# make_card.py
import sys
from pathlib import Path

CSS = Path(__file__).parent / "style.css"
TEMPLATE = """<!DOCTYPE html>
<html><head><style>{css}</style></head>
<body><div id="canvas">{steps}</div></body></html>"""
STEP = """<div class="step"><div class="title">{title}</div><div class="detail">{detail}</div></div>"""


def build(steps: list[tuple[str, str]]) -> str:
    css = CSS.read_text()
    body = "\n".join(STEP.format(title=t, detail=d) for t, d in steps)
    return TEMPLATE.format(css=css, steps=body)


if __name__ == "__main__":
    out = Path(sys.argv[1])
    steps = [
        ("Clone the repo", "git clone the project"),
        ("Install deps", "pip install -r requirements.txt"),
        ("Run the build", "make build"),
    ]
    out.write_text(build(steps))
    print(f"wrote {out}")
```

A fixed 800x500 frame with a variable list dropped into it is exactly the shape that breaks: it looks great with three steps and quietly overflows with seven.

## Give the layout room to adapt

Rather than pick one font size and hope every future caller respects it, let the CSS itself react to how many `.step` elements showed up. The `:has()` relational pseudo-class matches an element based on what's inside it, so a container can style itself differently depending on its own children ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/:has)):

```css
/* count-adaptive: exactly 3 steps get more room to breathe */
#canvas:has(> .step:nth-child(3):last-child) { gap: 36px; }
#canvas:has(> .step:nth-child(3):last-child) .title { font-size: 40px; }

/* count-adaptive: 5 or more steps compress to keep everything on-frame */
#canvas:has(> .step:nth-child(5)) { gap: 10px; }
#canvas:has(> .step:nth-child(5)) .title { font-size: 24px; }
#canvas:has(> .step:nth-child(5)) .detail { font-size: 16px; }
```

A sparse 3-step card scales up and fills the frame instead of floating in whitespace; a dense 5+ step card compresses to stay on-frame instead of overflowing. One template, no per-caller tuning.

## Build the render-time lint

The CSS above narrows the failure modes, but it doesn't guarantee anything, so the lint is what verifies a given render. It loads the page in Playwright and reads real box-model numbers off the live DOM with `page.evaluate` ([Playwright docs](https://playwright.dev/docs/api/class-locator#locator-bounding-box)):

```python
# lint.py
import sys
from playwright.sync_api import sync_playwright

STEP_BUDGET = (3, 5)  # inclusive min/max steps a card is allowed to carry

LINT_JS = """
() => {
  const findings = [];
  const canvas = document.getElementById('canvas');
  const cRect = canvas.getBoundingClientRect();

  // 1. clip-overflow: anything escaping the frame.
  for (const el of canvas.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom > cRect.bottom + 1 || r.right > cRect.right + 1) {
      findings.push(['FAIL', 'clip-overflow',
        el.className + ' extends past the frame (bottom ' + Math.round(r.bottom) +
        'px vs frame ' + Math.round(cRect.bottom) + 'px)']);
    }
  }

  // 2. ellipsis-fired: truncation actually happened.
  for (const el of canvas.querySelectorAll('.title')) {
    if (el.scrollWidth > el.clientWidth + 1) {
      findings.push(['FAIL', 'ellipsis-fired',
        '"' + el.textContent + '" is truncated (' + el.scrollWidth + 'px of text in ' +
        el.clientWidth + 'px)']);
    }
  }

  findings.push(['INFO', 'step-count', canvas.querySelectorAll('.step').length + ' steps']);
  return findings;
}
"""


def lint(html_path: str) -> list[tuple[str, str, str]]:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 900, "height": 600})
        page.goto(f"file://{html_path}")
        findings = page.evaluate(LINT_JS)
        browser.close()

    lo, hi = STEP_BUDGET
    count = next(int(m.split()[0]) for (_, code, m) in findings if code == "step-count")
    if not (lo <= count <= hi):
        findings.append(("FAIL", "count-budget", f"{count} steps, budget is {lo}-{hi}"))
    return findings


if __name__ == "__main__":
    findings = lint(sys.argv[1])
    for level, code, message in findings:
        print(f"{level} {code}: {message}")
    sys.exit(2 if any(level == "FAIL" for level, _, _ in findings) else 0)
```

The `scrollWidth > clientWidth` check is the standard way to prove an ellipsis fired rather than just being legal CSS that never triggers: `scrollWidth` is how wide the content would need to be to show it all, `clientWidth` is what it got ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth)).

## Run it against a good, a sparse, and a stressed card

A 3-step card renders and lints clean:

```text
$ python make_card.py good.html && python lint.py good.html
wrote good.html
INFO step-count: 3 steps
```

Edit the `steps` list in `make_card.py` down to 2 entries and rerun the same two commands. The count budget catches it before anyone has to notice the card looks thin:

```text
INFO step-count: 2 steps
FAIL count-budget: 2 steps, budget is 3-5
```

Grow the list back out to 7 entries, with one title long enough to overflow ("Configure the deeply nested production environment variable file"), and the lint catches the truncation directly, quoting the exact text that got cut:

```text
FAIL ellipsis-fired: "Configure the deeply nested production environment variable file" is truncated (744px of text in 720px)
INFO step-count: 7 steps
FAIL count-budget: 7 steps, budget is 3-5
```

Every one of those lines is something a human would otherwise have had to spot by squinting at a PNG.

## Gotchas

**`:has(> .step:nth-child(3))` without `:last-child` fires on every card with 3 or more steps, not exactly 3.** `nth-child(3)` only asserts that a 3rd child exists; it says nothing about whether a 4th or 5th one follows. I proved this to myself in a scratch page: a 5-step card with the anchor-less rule still painted its 3rd title red, because the 5-step card also has a 3rd child. Anchoring with `:nth-child(3):last-child` is the fix: it means "exactly 3, and that one is the last."

**A lint that can crash your render pipeline is worse than no lint.** The moment render-time checks run inside the same process that produces the shippable output, a bug in the lint itself (a null element, an unexpected DOM shape) can take down every render, not just the bad ones. Wrap the lint call so a lint exception degrades to a logged warning, never a failed render; the checks should only ever add information, not a new way to go down.

**Count-adaptive rules fix font size and spacing, not structural imbalance.** Scaling text up or down for 3 versus 5 items works fine until the count lands somewhere a grid can't distribute evenly, like exactly 3 tiles in a 2-column layout: one tile ends up alone on its own row, off-center. That case needs an explicit structural rule (span the odd tile across the full row), not just a smaller font. Count-adaptive CSS has to cover both the aesthetic scaling and the structural edge cases, or the "edge count" just moves somewhere new.

## Sources

- [MDN: :has()](https://developer.mozilla.org/en-US/docs/Web/CSS/:has) — the relational pseudo-class semantics and combinator syntax used for count-adaptive rules
- [Playwright: Locator.boundingBox()](https://playwright.dev/docs/api/class-locator#locator-bounding-box) — measuring live DOM geometry from inside a headless browser
- [MDN: Element.scrollWidth](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth) — the scrollWidth/clientWidth comparison used to detect a fired ellipsis
- [Percy: What is visual regression testing?](https://percy.io/blog/visual-regression-testing/) — why appearance bugs slip past tests that only check behavior

## Changelog

- feat(ghostwriter): graphics quality overhaul — render-time lint, count-adaptive cards, content-budget contract (#76) ([682884a](https://github.com/natejswenson/claude-skills/commit/682884a4fa8c624a467467978ae32ef70c3d56b1))
- feat(ghostwriter): v0.11.0 — outcome feedback loop, self-repairing radar, in-session UX (#75) ([eeae226](https://github.com/natejswenson/claude-skills/commit/eeae2260c4c97f944c778001fa5c8d309f635669))
