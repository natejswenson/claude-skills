# Release Radar — research task

You are running headless, twice a week, to produce a **release digest** for Nate's
LinkedIn ghostwriting. Your ONLY job is research and writing a local file. You do NOT
post anything to LinkedIn and you do NOT call any LinkedIn API or
`scripts/linkedin_post.py`. (LinkedIn ToS §3.1 bans automated posting; automated
*research* that writes a local digest is fine. See `COMPLIANCE.md`.)

## What to find

Recent, genuinely noteworthy developments across the **AI industry** that matter to engineers
building AI agents for ops, SRE, and CI/CD — Nate's audience. Not just Anthropic: cover the whole
field, but keep the relevance filter tight (it has to change what an ops/agent builder does or
thinks). Examples of what counts: new frontier models (any vendor), agent frameworks / SDKs, API
capabilities (tool use, computer use, batch, files, memory, prompt caching), coding-agent tooling,
LLMOps / eval / observability tooling, AI features landing in the cloud + CI/CD platforms Nate's
audience already runs (AWS, Kubernetes, GitHub Actions, Terraform), and pricing/limits/policy
shifts that hit automated workloads.

## Sources — prefer primary; ignore SEO blogs, hype roundups, and rumor

**Tier 1 — Anthropic (still the core; Nate builds on it):**
- Anthropic news: https://www.anthropic.com/news
- Claude Code release notes / CHANGELOG: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
  and the Claude Code docs at https://docs.claude.com
- Claude API / platform changelog and docs: https://docs.claude.com
- Anthropic engineering blog: https://www.anthropic.com/engineering

**Tier 2 — broader AI industry (include when relevant to the audience above):**
- OpenAI: https://openai.com/news and https://platform.openai.com/docs/changelog
- Google: https://blog.google/technology/ai/ , Google DeepMind, and Vertex AI release notes
- AWS AI & agents (Bedrock, Q, agent tooling): https://aws.amazon.com/about-aws/whats-new/
- Major agent / LLMOps tooling — agent frameworks (e.g. LangChain/LangGraph, LlamaIndex),
  eval / observability, and coding-agent tools — via their own changelogs / release notes.

Use WebSearch to find what shipped, then confirm each item against a **primary source** (the
vendor's own announcement, docs, or changelog) before including it. If a claim only appears on a
third-party hype site, drop it. Note each item's vendor/source in the digest.

**Hard verification gate — an item you did not confirm does not exist.** For every item, you must
have actually retrieved the primary source this run and seen it state the fact — a search snippet,
your own prior knowledge, or a plausible-sounding headline is NOT confirmation. Never include a
release you couldn't fetch, and never include anything dated in the future. A short digest of
verified items beats a full one with a hallucinated release — one invented item poisons the whole
downstream post pipeline.

## Window & dedup

- Look at the **most recent ~1–2 weeks** of releases.
- Read the newest existing `research/release-radar-*.md` file (if any). Do NOT re-list
  items already covered there. Only include things new since the last digest.

## Voice constraints for the suggested angles (important)

The angle is the part Nate will actually use, so it must obey his voice rules
(`voice/voice-notes.md` is the source of truth — these are a summary):

- **Prescriptive, for the reader** — "here's what you should do / what your tooling
  should now handle," NOT "look what $VENDOR announced" and NOT autobiographical
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
- **What shipped:** <one factual line> (<vendor>) — <source URL>
- **Why it matters (ops/agent builders):** <1–2 lines>
- **Suggested angle:** <a prescriptive, Nate-voice hook — the implication, not the news>

## 2. ...

---

## Discussion radar

### D1. <short title>
- **The debate:** <one line on what practitioners are actually arguing about> — <source URL(s)>
- **Suggested angle:** <the specific position Nate could argue, prescriptive, from his ops/agent-builder seat>
```

Include **2–4 release items**. If nothing genuinely post-worthy shipped this cycle, write a
single line saying so under the title instead of padding with weak items. Keep it tight.

**Discussion radar (1–2 items):** the release lane misses the opinion/career posts that do well
for Nate, so also surface one or two live, genuinely-debated questions in his lanes — how AI is
changing DevOps/SRE/platform work, agent reliability in production, engineering-career shifts
(IC paths, hiring, skills). Same source discipline: it must be traceable to real primary
material (a named company's policy/post, a published study, a specific talk or RFC — not vibes
or an unattributed hot take). Same verification gate applies. If nothing real is being debated,
omit the section rather than inventing a controversy.
