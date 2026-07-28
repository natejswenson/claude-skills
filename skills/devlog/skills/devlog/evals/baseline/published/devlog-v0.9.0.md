---
title: "Enforcing a layout contract on AI-drawn images with a DOM geometry gate"
date: 2026-07-18
project: devlog
version: v0.9.0
tags: [playwright, llm-agents, image-generation, dom, getboundingclientrect, validation, svg, headless-chromium]
summary: "Style-guide prose can ask an agent to draw inside a box; it can't make it happen. How to measure the rendered DOM in headless Chromium and refuse to rasterize any composition that breaks the layout contract."
---

## Shipped

devlog v0.9.0 gave cover generation two things: a 20-icon SVG catalog for small accent glyphs, and a fixed hero zone, a 1300x400 box every cover's illustration must occupy. The interesting part is the enforcement. The renderer now measures the composed page in headless Chromium and throws before taking the screenshot if the hero zone is missing, misplaced, or has a catalog icon drifting into it. This post is about that pattern: when an agent composes visual output, put the layout rules in a geometry check, not just in the prompt.

## Why prose rules weren't enough

My covers are HTML/SVG documents composed by an agent from a style guide, then rasterized to PNG. The style guide said things like "catalog icons are never the hero illustration." The old safeguard for that rule was a regex asserting the sentence still existed in the instructions. That checks the rule is *stated*; it says nothing about whether any given cover *follows* it. An agent could compose two catalog icons connected by a line, call that the hero, and nothing mechanical would object.

The fix is to make the rule checkable in the artifact itself. Two conventions do the work:

- The required region is an element with a well-known id, `#hero-zone`, at exact coordinates.
- Every restricted element carries a machine-readable marker, a [`data-*` attribute](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Solve_HTML_problems/Use_data_attributes) like `data-catalog-icon="git"`, so the checker can find them with a `[data-catalog-icon]` selector.

Once the contract is addressable in the DOM, you can measure it.

## Build the gate: rect math that can't be gamed

Start with the contract and two helpers in `layout-gate.mjs`:

```js
// layout-gate.mjs
// The fixed box the composition must place its illustration container in,
// on a 1600x900 canvas. Single source of truth; the style guide states the
// same numbers as prose.
export const HERO_ZONE = { x: 150, y: 425, width: 1300, height: 400 };

// getBoundingClientRect() returns DOMRect values typed as unrestricted
// double, so subpixel results are legal; exact equality would flake.
// 2px absorbs rounding without becoming a real size allowance.
const TOLERANCE_PX = 2;

// Exact-match within tolerance, NOT containment. A containment check is
// gameable: a tiny box in a corner is still "inside" the target, and a
// tiny box trivially avoids overlapping anything.
function withinTolerance(rect, fixed) {
  return (
    Math.abs(rect.x - fixed.x) <= TOLERANCE_PX &&
    Math.abs(rect.y - fixed.y) <= TOLERANCE_PX &&
    Math.abs(rect.width - fixed.width) <= TOLERANCE_PX &&
    Math.abs(rect.height - fixed.height) <= TOLERANCE_PX
  );
}

// Positive-area intersection only: rects that merely touch along an edge
// do not count as overlapping.
function rectsOverlap(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top;
}
```

Then the check itself. It runs inside the page via [`page.evaluate`](https://playwright.dev/docs/evaluating), which executes the callback in the browser context and serializes the result back to Node; DOM rects have to be copied into plain objects on the browser side:

```js
// layout-gate.mjs (continued)
export async function checkLayout(page) {
  const zones = await page.evaluate(() =>
    [...document.querySelectorAll('#hero-zone')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })
  );

  // Structurally mandatory: zero matches and duplicates are both errors,
  // never "skip the check" or "take the first one."
  if (zones.length === 0) throw new Error('layout gate: no #hero-zone element');
  if (zones.length > 1) throw new Error(`layout gate: ${zones.length} #hero-zone elements`);

  const zone = zones[0];
  if (!withinTolerance(zone, HERO_ZONE)) {
    throw new Error(
      `layout gate: #hero-zone at x:${zone.x} y:${zone.y} ` +
      `${zone.width}x${zone.height}, expected x:${HERO_ZONE.x} y:${HERO_ZONE.y} ` +
      `${HERO_ZONE.width}x${HERO_ZONE.height}`
    );
  }

  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('[data-catalog-icon]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('data-catalog-icon'), x: r.x, y: r.y, width: r.width, height: r.height };
    })
  );

  const offending = icons.filter((i) => rectsOverlap(i, zone)).map((i) => i.name);
  if (offending.length > 0) {
    throw new Error(`layout gate: catalog icons inside the hero zone: ${offending.join(', ')}`);
  }
}
```

The measurement is [`getBoundingClientRect`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect), which reports each element's rendered position and size in pixels relative to the viewport. That's the point of the whole design: you're checking what Chromium actually laid out, not what the markup claims.

## Wire it in before the screenshot

You need the full `playwright` package and a Chromium build (`npm i playwright && npx playwright install chromium`). The gate goes between page load and rasterization, so a bad composition fails loudly instead of producing a wrong image:

```js
// render.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkLayout } from './layout-gate.mjs';

export async function render(htmlPath, outPath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.setContent(readFileSync(htmlPath, 'utf8'), { waitUntil: 'networkidle' });
    await checkLayout(page); // throws on any contract violation
    writeFileSync(outPath, await page.screenshot());
  } finally {
    await browser.close();
  }
}
```

In my pipeline the caller catches the throw, feeds the error text back to the agent for one recomposition attempt, and otherwise publishes without a cover. The gate's error messages carry the measured numbers for exactly that reason; "your box is at y:300, expected y:425" is a prompt the agent can act on.

## Try it against a cheating layout

Make one compliant page and one that breaks the contract:

```html
<!-- good.html -->
<!DOCTYPE html>
<html><head><style>html, body { margin: 0; width: 1600px; height: 900px; }</style></head>
<body>
  <div id="hero-zone" style="position:absolute; left:150px; top:425px; width:1300px; height:400px;"></div>
</body></html>
```

```html
<!-- cheat.html: tiny hero zone parked in a corner -->
<!DOCTYPE html>
<html><head><style>html, body { margin: 0; width: 1600px; height: 900px; }</style></head>
<body>
  <div id="hero-zone" style="position:absolute; left:20px; top:20px; width:80px; height:60px;"></div>
</body></html>
```

Run both:

```js
// verify.mjs
import { render } from './render.mjs';

await render('good.html', 'good.png');
console.log('good.html rendered');
try {
  await render('cheat.html', 'cheat.png');
} catch (e) {
  console.log('cheat.html rejected:', e.message);
}
```

Output from my run of these exact files:

```text
good.html rendered
cheat.html rejected: layout gate: #hero-zone at x:20 y:20 80x60, expected x:150 y:425 1300x400
```

Add a `data-catalog-icon` element inside the zone to `good.html` and it flips to the overlap error, naming the icon.

## Gotchas

- **Containment instead of exact-match.** The tempting check is "is the zone inside the canvas region." Symptom: covers pass the gate with a postage-stamp hero zone, because a tiny box is contained by anything and overlaps nothing. Escape: compare all four rect values against the fixed contract, within tolerance; the `cheat.html` run above is the regression test.
- **Exact equality on measured pixels.** DOMRect fields are `unrestricted double` per the [geometry spec](https://drafts.csswg.org/geometry/), so layout can hand you 424.996 for your 425. Symptom: the gate rejects visually perfect compositions intermittently. Escape: a small absolute tolerance (2px here); keep it small enough that it never becomes a design allowance.
- **The gate validates the box, not what's in it.** This one bit me a day after shipping: a cover can place `#hero-zone` perfectly and still strand a thin band of marks in a mostly-empty rectangle, passing every mechanical check while failing as an image. The v0.10.0 style guide added an explicit fill floor for exactly this reason. Escape: know which rules are geometry (checkable here) and which are composition quality; the latter need a different gate, or eyes.
- **Duplicate ids fail open if you use `querySelector`.** `querySelector('#hero-zone')` silently returns the first match, so a stray second zone would be invisible to the check. Symptom: none, which is the problem. Escape: `querySelectorAll` and treat any count other than one as an error.

## Sources

- [MDN: Element.getBoundingClientRect()](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) — what the measured rect contains and that it reflects rendered position/size in pixels
- [CSSWG Geometry Interfaces spec](https://drafts.csswg.org/geometry/) — DOMRect fields are `unrestricted double`, so subpixel values are legal
- [Playwright: Evaluating JavaScript](https://playwright.dev/docs/evaluating) — `page.evaluate` runs in the browser context and serializes results back
- [MDN: Using data attributes](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Solve_HTML_problems/Use_data_attributes) — marking restricted elements so a checker can select them

## Changelog

- feat(devlog): icon catalog + geometry-enforced hero zone for cover quality (v0.9.0) ([8848307](https://github.com/natejswenson/claude-skills/commit/8848307e00d37e0a76d1a3a3a77f7d360e8ed7ff))
