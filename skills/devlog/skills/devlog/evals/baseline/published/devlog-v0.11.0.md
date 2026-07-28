---
title: "Auditing an AI skill against its own past runs"
date: 2026-07-19
project: devlog
version: v0.11.0
tags: [ai-agents, agent-evaluation, postmortems, claude-code, subagents, git-forensics, guardrails, transcripts]
summary: "Version 0.11.0 of this skill came entirely out of one exercise: asking the model to review the skill's own previous six runs. Here is the four-lens audit loop that produced it, and what the round cost in tokens."
---

## Shipped

devlog 0.11.0 is a batch of guardrails: tombstones so a deleted entry can never republish itself, a ground-truth gate that verifies every claim about my own repos against git before publishing, a mechanical version of the run-the-code check, deterministic voice linting, and a fix for a CLI command that silently ignored fresh input. None of it came from a feature idea. All of it came from asking the model to review the skill's own past six runs. That review loop is the technique worth teaching; this guide walks through running it on your own agent skill.

## The four lenses

An agent skill drifts quietly. No single run fails hard enough to file a bug, but small problems repeat until they are load-bearing. The fix is the same discipline SRE applies to incidents: document what happened, understand the causes, and put preventive actions in place so it stops recurring ([Google SRE book, postmortem culture](https://sre.google/sre-book/postmortem-culture/)). The difference is that your "incident" is spread across runs, so you have to go collect it.

I review on four dimensions, each answering one question:

- **Accuracy**: did the runs do what the skill promises? For a writing skill, are the claims in the output true?
- **Completeness**: what did the runs miss, and what did a human have to clean up afterward?
- **Efficiency**: where did tokens and wall-clock time go that produced no value?
- **Agent UX**: where did the skill's own instructions or tools fight the agent executing them?

The last one surprises people. The agent is a user of your skill, and it hits usability bugs the same way humans do; it just cannot file a complaint. You find those bugs in transcripts.

## Three evidence streams

A run leaves three artifact trails, and each lens needs a different one.

First, the outputs themselves: whatever the skill publishes. Grade a sample against the skill's own quality contract, and verify factual claims against the system of record instead of taking the output's word for it.

Second, the correction commits. If your skill writes into a git repo, every manual fix a human made after a run is a finding with a timestamp. Separate the skill's own commits from everything else:

```bash
# Commits the skill's happy path writes (use your skill's commit message):
git log --date=short --pretty='%h %ad %s' --grep='add release entries'

# Everything a human had to do around them:
git log --date=short --pretty='%h %ad %s' --invert-grep --grep='add release entries'
```

Running that against my dev-log repo (output trimmed to the signal lines):

```text
9b26494 2026-07-18 devlog: add release entries
8f8938a 2026-07-17 devlog: add release entries
...
83cd9de 2026-07-18 chore: assign permanent entry numbers to all 55 entries
c160db1 2026-07-17 devlog: file market-research v0.1.0 entry under personal
```

The second list held the review's best material: an entry reverted the same day a run re-added it, three posts consolidated into one by hand, and a moved file (that `c160db1` line) that the next run would have silently regenerated. Manual cleanup is the skill telling you what it cannot do yet.

Third, the transcripts. Claude Code stores session logs as JSONL under `~/.claude/projects/`, one directory per working directory. Find the sessions where your skill ran by grepping for a command only it uses:

```bash
grep -l 'devlog scan --json' ~/.claude/projects/*/*.jsonl
```

Then pull rough per-run metrics. Transcript size is a fair cost proxy, and counting CLI invocations or retries shows where the loop stalled:

```bash
f=$(grep -l 'devlog scan --json' ~/.claude/projects/*/*.jsonl | head -1)
wc -c < "$f"                      # transcript bytes, a rough cost proxy
grep -c '"name":"Bash"' "$f"      # shell tool calls in the session
```

```text
 2762710
95
```

## Fan out reviewers that can touch ground truth

One reviewer reading everything runs out of context and blends the lenses together. I dispatch one subagent per evidence stream and give each a narrow brief plus access to the real repos. The prompt shape matters more than the wording:

```markdown
You are auditing the output quality of the <skill> agent skill.
The skill's contract is at <path to SKILL.md>; read it first.

For each published output:
1. Grade it against the contract, point by point.
2. Verify its factual claims against the SOURCE repo's git history
   (tags, diffs, commit messages), not against the output's own text.
3. Report patterns across outputs, each with concrete evidence
   (file, commit hash, or quote).

Be skeptical and specific; this feeds a fix list, not a report card.
```

Point 2 is the one you cannot skip. My accuracy reviewer found a published post whose central premise was false: it claimed two of four packages in a release never got git tags, and a single `git tag -l` showed all four tags existed. The post had passed the skill's self-review, because self-review graded the draft against the writing contract, never against the repo. A reviewer without repo access would have graded the same lie the same way.

## Ship findings as gates, then re-run

A review that produces a document has not improved anything yet. The SRE postmortem bar applies: findings become prioritized action items or they are theater ([postmortem culture](https://sre.google/sre-book/postmortem-culture/)). For agent skills I hold a stricter line: every finding ships as a mechanical gate in the next version, because an instruction the agent is supposed to remember is exactly the thing the review just proved gets skipped. Reflexion showed that agents improve when reflections persist somewhere durable instead of evaporating with the episode ([Shinn et al., 2023](https://arxiv.org/abs/2303.11366)); for a skill, the durable place is the code path the agent cannot route around.

Two examples from this round. The false-premise finding became a required pre-publish step: list every claim the draft makes about your own repo, then verify each with a git command run in that session, and delete what you cannot verify. The cleanup-commit findings became identity guardrails; a retired artifact now keeps a tombstone row in its manifest, and the publish path refuses it:

```json
{ "version": "v0.1.0", "file": "v0.1.0.md", "removed": true,
  "reason": "consolidated into the 2026-07-17 entry" }
```

```js
function refuseTombstoned(manifest, version) {
  const tombstoned = manifest.entries.find(
    (e) => e.removed && e.version === version,
  );
  if (tombstoned) {
    throw new Error(
      `${version} was editorially retired (${tombstoned.reason}); refusing to republish.`,
    );
  }
}
```

Transcript findings usually fix the tool, not the prompt. Anthropic's agent guidance says to invest in the agent-computer interface the way you would invest in UI design ([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)), and my transcripts proved why: a render command that silently no-opped when its output already existed cost the agent a multi-call debugging dance in two separate runs. The fix was one reordered check in the CLI, worth more than any added instruction.

Then re-run the skill. The next real run is the acceptance test: this post was generated by the version the audit produced, its opening scan reported the new CLI version, and the retired entry scanned as tombstoned instead of resurfacing as a new release.

On cost, since I had never tallied it: the three review subagents in this round reported 337k tokens between them, and the three code-exploration agents that turned findings into an implementation plan reported another 273k. Call the whole round about 600k subagent tokens plus the main session. That is real money, and it bought eighteen files of shipped fixes; I would not spend it weekly, but per release milestone it has paid for itself every time.

## Gotchas

- **Self-review grades the essay, not the facts.** Trap: letting the skill's quality check compare the draft to a rubric while every factual claim goes unchecked. Symptom: a confident, well-structured output with a false premise sails through. Escape: give reviewers (and the skill itself) repo access and require a verification command per claim; a claim you cannot verify gets removed, not softened.
- **Honor-system steps are skipped exactly when they matter.** Trap: writing "run the code blocks and check the output" as an instruction. Symptom: outputs that say "this is the real output" over code that cannot run; my audit found one whose demo files were never defined anywhere. Escape: turn the instruction into a command the agent runs (mine extracts a draft's code blocks into numbered files), so skipping it becomes visible instead of silent.
- **Output-only reviews miss tool friction entirely.** Trap: auditing what the skill produced and never how the agent got there. Symptom: the outputs look fine while every run quietly burns calls fighting the same CLI quirk. Escape: make transcripts a first-class evidence stream; the silent no-op I fixed in 0.11.0 appeared in zero outputs and two transcripts.
- **The review has a real price and nobody is tracking it.** Trap: running fan-out reviews on a schedule without measuring them. Symptom: a surprise in the usage dashboard. Escape: pull the token counts from your platform's subagent usage reports while the round is fresh, and set the cadence from the number instead of a hunch.

## Sources

- [Google SRE Book: Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) — blameless postmortems, and findings becoming prioritized preventive action
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — measure and iterate; invest in the agent-computer interface like UI design
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) — agents improve when reflections persist in durable memory across episodes

## Changelog

- feat(devlog): 0.11.0 — tombstones, ground-truth gate, and the six-run audit fixes (#86) ([bd8fa5d](https://github.com/natejswenson/claude-skills/commit/bd8fa5d88a8c33dbf6f13ed64394b0682b4b8f4b))
