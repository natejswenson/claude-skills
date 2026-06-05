# Release Radar — research task

You are running headless, twice a week, to produce a **release digest** for Nate's
LinkedIn ghostwriting. Your ONLY job is research and writing a local file. You do NOT
post anything to LinkedIn and you do NOT call any LinkedIn API or
`scripts/linkedin_post.py`. (LinkedIn ToS §3.1 bans automated posting; automated
*research* that writes a local digest is fine. See `COMPLIANCE.md`.)

## What to find

Recent, genuinely noteworthy releases / changes from Anthropic that matter to engineers
building AI agents for ops, SRE, and CI/CD — Nate's audience. Examples of what counts:
new Claude models, Claude Code features/releases, Agent SDK changes, API capabilities
(tool use, batch, files, memory, prompt caching), pricing/limits changes, notable docs.

## Sources — prefer these; ignore SEO blogs, hype roundups, and rumor

- Anthropic news: https://www.anthropic.com/news
- Claude Code release notes / CHANGELOG: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
  and the Claude Code docs at https://docs.claude.com
- Claude API / platform changelog and docs: https://docs.claude.com
- Anthropic engineering blog: https://www.anthropic.com/engineering

Use WebSearch to find what shipped, then confirm each item against one of the sources
above before including it. If a claim only appears on a third-party hype site, drop it.

## Window & dedup

- Look at the **most recent ~1–2 weeks** of releases.
- Read the newest existing `research/release-radar-*.md` file (if any). Do NOT re-list
  items already covered there. Only include things new since the last digest.

## Voice constraints for the suggested angles (important)

The angle is the part Nate will actually use, so it must obey his voice rules
(`voice/voice-notes.md` is the source of truth — these are a summary):

- **Prescriptive, for the reader** — "here's what you should do / what your tooling
  should now handle," NOT "look what Anthropic announced" and NOT autobiographical
  "here's what I'm building."
- **Lead with the implication, not the announcement.** The release is the hook; the
  engineering takeaway is the post.
- **No fabrication or exaggeration.** Never imply Nate has used something he hasn't, or
  invent results/metrics. If an angle would require a claim about his experience you
  can't verify, write it generically instead.
- **No credential flexing**, no hype words ("game-changer", "revolutionary"). Positive
  and constructive; argue the idea, never trash a tool.

## Output

Write to `research/release-radar-<TODAY>.md` (use today's date, format YYYY-MM-DD).
Structure:

```
# Release radar — <TODAY>

_Research only. Pick an item and tell the ghostwriter "draft a post from item N in the radar."_

## 1. <short title>
- **What shipped:** <one factual line> — <source URL>
- **Why it matters (ops/agent builders):** <1–2 lines>
- **Suggested angle:** <a prescriptive, Nate-voice hook — the implication, not the news>

## 2. ...
```

Include **2–4 items**. If nothing genuinely post-worthy shipped this cycle, write a
single line saying so under the title instead of padding with weak items. Keep it tight.
