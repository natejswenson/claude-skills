---
title: "Encoding the fix into the skill, not just the code: how one agent session backfilled 49 cover images"
date: 2026-07-16
project: devlog
version: v0.8.1
tags: [claude-code, skills, subagents, ai-agents, devlog, image-generation, playwright]
summary: "devlog v0.8.1 fixed bland, repetitive cover images, but the fix that stuck wasn't in the render code. It was a line added to the skill's own instructions and a machine-checked invariant, which is what let one Claude Code session regenerate all 49 backfilled covers in parallel and get them right the second time."
---

## Shipped

devlog v0.7.0 through v0.8.1 added a `private` project type and a full cover-image pipeline: every post gets a rendered 1600x900 PNG from a headless browser, feeding the feed thumbnail, post hero, OG card, and RSS enclosure. The render pipeline (Playwright screenshotting an HTML/SVG document, `sharp` for palette quantization) is real code and it's covered further down, but it's not the interesting part of this release.

The interesting part is that the first batch of 49 backfilled covers all looked the same, one shared template, and the fix wasn't a code change at all. It was rewriting the skill's own instructions and adding a rule the skill checks for itself, then letting one agent session regenerate every cover from that new instruction, in parallel, without a human opening an image editor.

## The skill file is the product, not the render code

`devlog` is a Claude Code skill: a `SKILL.md` plus supporting files that Claude loads when composing a release. Skills exist for exactly this shape of problem. The Claude Code docs put it directly: "Unlike CLAUDE.md content, a skill's body loads only when it's used, so long reference material costs almost nothing until you need it" ([Claude Code docs: Extend Claude with skills](https://code.claude.com/docs/en/skills)). The cover-composition procedure, the palette, the font, the "never do this" list, all of it lives in files an agent reads at the moment it needs them, not in a prompt retyped every release.

The first version of that procedure described a palette and a font and left composition open: a title, a kicker, an optional shape. Every one of the 49 backfilled covers took that literally, big headline text, one of three rotating stock shapes in a corner. Technically correct, visually identical, and a waste of the space.

The fix went into `SKILL.md` itself, as an instruction the agent has to follow before it's allowed to compose a cover:

```text
# 2. Compose the cover using ONLY this release's title/tags/summary/`## Shipped` text
#    (never the raw draft file, never `## Changelog`) plus the returned style guide and
#    reference images. A cover that just re-renders the title in large text is a failure —
#    find the one concrete mechanism this release is actually about (not the project name,
#    not "a bug fix") and draw ONE custom inline-SVG illustration of it, sized as the
#    dominant visual element of the canvas; title/kicker stay secondary. Two different
#    releases should never produce visually similar covers...
```

And it went into `skill-invariants.json`, a second, independent list of rules the skill checks itself against, separate from the step-by-step instructions:

```json
{
  "id": "cover-custom-illustration",
  "pattern": "cover that just re-renders the title in large text is a failure",
  "rationale": "First shipped version of this feature produced a shared text-heavy template with a rotating stock shape — rejected as bland/repetitive. Losing this line reopens that regression."
}
```

The `rationale` field is the part worth noticing. It doesn't describe what the rule does, the pattern line already does that. It records why the rule exists, so the next time someone (or some agent) is tempted to trim that sentence from `SKILL.md` as boilerplate, the invariant file is right there explaining what regression comes back if they do. A skill without that second file just has good intentions that erode one edit at a time.

## What let one session redo 49 images: subagents, not a loop

Rewriting the style guide fixes new posts. It does nothing for 49 already-published ones sitting on disk with the old bland covers. Regenerating all of them serially, in the same conversation, one render-review-adjust cycle at a time, would have flooded that conversation with 49 rounds of image output long before it reached the last one.

Claude Code's subagents exist for that specific shape of problem. Per the docs: "Each subagent runs in its own context window with a custom system prompt, specific tool access, and independent permissions" ([Claude Code docs: Create custom subagents](https://code.claude.com/docs/en/sub-agents)). Seven of them ran in parallel, each working a batch of the 49 posts against the new style guide and invariant, each returning only the finished covers rather than the back-and-forth it took to get there. The main session stayed free to keep working on the render pipeline and the site-side bugs below while the batches came back.

That split, one thread holding the plan and doing the review, several isolated threads doing the repetitive regeneration, is what made "redo all 49, today" a reasonable thing to ask for instead of a multi-day queue of manual image tweaks.

## Build it: the part that's still ordinary code

The render step itself is unglamorous by comparison: build an HTML string with CSS and hand it to a headless browser to screenshot, the same approach Playwright's own docs describe, where "the browser handles fonts, gradients, flexbox, and every other CSS feature" for you ([Playwright: Screenshots](https://playwright.dev/docs/screenshots)). Launch the browser, set a fixed viewport, load the HTML, wait for the bundled font to actually finish loading before the screenshot (`document.fonts.ready`, which per MDN "will only resolve once the document has completed loading fonts... and no further font loads are needed" ([MDN: FontFaceSet.ready](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready))), then hand the screenshot to `sharp` with `palette: true` for quantization. Skip the wait and every cover silently renders in the fallback sans-serif; nothing throws.

```js
export async function renderCover(html, { width = 1600, height = 900 } = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.addStyleTag({ content: fontFaceCss });
    await page.evaluate((f) => document.fonts.load(`1em '${f}'`), FONT_FAMILY);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: 'png' });
    return await sharp(png).png({ palette: true }).toBuffer();
  } finally {
    await browser.close();
  }
}
```

Quantization is a real size win for flat illustrations specifically: the same 1600x900 test render came out at 27306 bytes with plain PNG encoding and 4989 bytes with `palette: true`. It's the wrong setting for anything with a smooth gradient, one more reason the style guide asks for flat, limited color instead.

## Gotchas

**A style guide that only describes the palette gets you a consistent palette and nothing else.** The part that needed to be explicit, in writing, in the file the agent actually reads, was the part everyone assumed went without saying: don't just render the title. Leaving it implicit is how the first 49 covers all ended up looking the same.

**A local content cache silently overrode the field that made covers work at all.** The site that consumes these covers keeps a local copy of already-published posts for editorial preview, and that local copy wins over the remote source when both exist, which is nearly all posts. It had no `cover` field, so the merge defaulted every cover-bearing post back to "no cover" the moment it also had a local copy. Only 1 of the first 49 backfilled covers actually rendered on the live site until this shipped, caught by rebuilding the site and checking real output instead of trusting the pipeline.

**Once the cover carried the title, the plain-text heading above it duplicated it.** A covered post showed the same headline twice, once in the image, once in the `<h1>` right above it. The fix drops the separate heading for covered posts and lets the card, image plus a caption line for date and read time, be the visible heading, while a screen-reader-only `<h1>` keeps one real heading in the page structure.

## Sources

- [Claude Code docs: Extend Claude with skills](https://code.claude.com/docs/en/skills) — confirms skills load reference material on demand rather than living in the always-loaded CLAUDE.md.
- [Claude Code docs: Create custom subagents](https://code.claude.com/docs/en/sub-agents) — confirms each subagent runs in an isolated context window, which is what made parallel batches of the 49-cover regeneration practical.
- [MDN: FontFaceSet.ready](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready) — the exact resolution condition for waiting on font loads before a screenshot.
- [Playwright: Screenshots](https://playwright.dev/docs/screenshots) — confirms the "build HTML, screenshot it" approach the render step relies on.

## Changelog

- fix(devlog): cover style guide mandates one custom illustration per post (0.8.1) ([ef46024](https://github.com/natejswenson/claude-skills/commit/ef460249b421ce9242ec121f982037e64e650ba0))
- feat(devlog): auto-generate cover images for every post (v0.8.0) (#72) ([88d4c96](https://github.com/natejswenson/claude-skills/commit/88d4c96a176458f7f30d23e1307ddacab2b86829))
- feat(devlog): add a private project type (v0.7.0) ([21f418a](https://github.com/natejswenson/claude-skills/commit/21f418a249f82869e66f27e38956dbc00044ae5b))
- feat(devlog): tag cap raise, validation, manifest write-through (#71) ([b699bc1](https://github.com/natejswenson/claude-skills/commit/b699bc1e8cdfd580a97b903896d357fe22f6dbe2))
