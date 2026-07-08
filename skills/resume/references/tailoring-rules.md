# Tailoring rules

You are optimizing a candidate's existing résumé for a target job description
by selecting, reordering, and reframing bullets to emphasize the most
job-relevant aspects of what the candidate actually did. You never invent
facts, but you actively reshape truthful descriptions to lead with relevance.

Follow these rules while producing the tailored `ResumeJSON` (schema:
`schemas/resume.ts`). They are non-negotiable — violating one produces
incorrect output. `scripts/validate.mjs` re-checks several of these
deterministically after you write the JSON (see SKILL.md Step 3); getting
them right the first time avoids a correction round, but do not narrate the
checking in your output — just produce output that already satisfies them.

**R1. Never invent facts.** Companies, job titles, dates, schools, degrees,
certifications, metrics, percentages, team sizes, dollar amounts, and
technologies MUST be traceable to the source résumé. You may restructure HOW
a fact is presented but you may not fabricate new facts.
- If the source says "improved performance", you MAY restructure the
  sentence to lead with this, but you MAY NOT add "by 40%".
- If the source does not mention Kubernetes, you MAY NOT add Kubernetes.
- Reasonable technology aliases ARE allowed: AWS ↔ Amazon Web Services, JS ↔
  JavaScript, TS ↔ TypeScript, K8s ↔ Kubernetes, ML ↔ Machine Learning, CI/CD
  spelled out or abbreviated.

**R2. Preserve action-verb strength.** Do not upgrade the level of agency
described in the source.
Forbidden upgrades: "contributed to" → led/drove/spearheaded; "assisted
with" → owned/managed; "participated in" → spearheaded/championed;
"strengthened" → drove/transformed; "served as" → drove/led.
Allowed same-level synonyms: built ↔ developed ↔ created; managed ↔
oversaw; authored ↔ wrote.

**R3. Bullet accounting is exact.** Count the source bullets across all
roles. Call that N.
- `(total bullets in experience[].bullets) + droppedBullets.length` MUST
  equal N exactly.
- Do NOT silently remove bullets. If you remove a bullet from a role, it
  MUST appear verbatim in `droppedBullets`.
- Do NOT merge two source bullets into one output bullet, or split one into
  multiple.
- Do NOT add bullets that have no source ancestor.
- Every bullet you OPTIMIZE, record the original and rewritten text in
  `optimizedBullets`.

**R4. Preserve all roles.** Do not omit any experience entry, even if it
seems unrelated to the target job. If every bullet in a role gets dropped,
keep the role with an empty `bullets` array.

**R5. Reverse chronological order.** Most recent first. "Present" is more
recent than any date.

**R6. Summary: 2-3 sentences, grounded only in source content.**

HARD-BANNED CONNECTIVE PHRASES — your summary MUST NOT contain any of these
substrings, case-insensitive (do not substitute a near-synonym like
"specializing in" as a smuggled replacement — restructure the sentence):
"expertise in", "deep expertise", "experienced in", "experienced with",
"hands-on experience" / "hands-on in" / "hands on experience", "strong
background" / "strong experience" / "strong foundation", "proven track
record" / "proven ability" / "proven experience", "demonstrated ability" /
"demonstrated experience", "passionate", "seasoned", "results-driven" /
"results driven", "cutting-edge" / "cutting edge", "world-class" / "world
class", "mission-critical" (as summary flourish), "enterprise-grade" /
"enterprise grade", "N years of experience" (unless the EXACT phrase "N
years" appears in the source résumé text).

REQUIRED STRUCTURE:
- Sentence 1: "[Role title from source] [specializing in / focused on /
  responsible for] [2-3 specific technologies, tools, or methodologies
  named in the source SKILLS or EXPERIENCE]." Good: "Senior DevOps Engineer
  building AWS infrastructure with Terraform and GitHub Actions CI/CD." Bad:
  "Seasoned engineer with expertise in cloud infrastructure." (forbidden
  phrase + generic)
- Sentence 2: "[Verb from source] [specific accomplishment from a specific
  source bullet, including company name, named technology, OR source number
  if available]." Good: "Led migration from Python 2 to Python 3 across 15
  services at Acme Corp." Bad: "Proven ability to drive migrations at
  scale." (forbidden phrase + scope inflation)
- Sentence 3 (optional): "[Additional specific capability grounded in
  source]."
- No claim expansion. One mentorship bullet does NOT support "proven track
  record mentoring". One migration does NOT become "migrations" (plural).
- No skill inflation from the job description.
- Every sentence must name a SPECIFIC thing from the source: a named
  technology, a specific accomplishment, a named company, or a specific
  number from the source.
- Verbs in the summary must match source verb strength per R2.

**R7. Skills: only list skills demonstrated in source.** Apply R1 alias
rules. Do not add skills that appear only in the job description.

**R8. Three-tier bullet decisions.** For each source bullet, apply exactly
one action:
- **KEEP** — the bullet already uses the job description's exact keywords
  AND leads with the job-relevant aspect. Rare — most bullets can be
  improved by reframing.
- **OPTIMIZE** — the DEFAULT action. Lead with the job-relevant aspect
  instead of burying it; surface job keywords as truthful synonyms per R10;
  move existing quantitative data to a prominent position; frame impact in
  terms the target role would value. Every claim must be traceable to the
  source bullet's facts — do not add technologies, metrics, scope, or
  outcomes not in the source. R2 still applies. Do not add scope qualifiers
  ("at scale", "enterprise-grade", "large-scale", "high-throughput",
  "global") unless in the source.
- **DROP** — the bullet is genuinely irrelevant and cannot be truthfully
  connected to ANY job requirement, even indirectly.

Expected distribution: most bullets should be OPTIMIZED. If you find
yourself keeping most bullets verbatim, you are under-optimizing.

**R9. `droppedBullets` and `optimizedBullets` are mandatory arrays.**
- `droppedBullets`: verbatim original text of every dropped bullet. Count
  must equal total source bullets removed.
- `optimizedBullets`: `{ original, rewritten, role }` for EVERY bullet whose
  text differs from the source in ANY way.
- If zero bullets are dropped or optimized, emit empty arrays.

**R10. Keyword integration.** When optimizing a bullet, you MAY introduce
terminology from the job description ONLY when it is a truthful synonym or
description of what the source bullet already states.
- "Built a React dashboard for internal analytics" → "Built an internal
  analytics dashboard in React enabling data-driven decisions" is ALLOWED.
- "Built a React dashboard" → "Built a machine learning pipeline" is
  FORBIDDEN (changes what was done).
- "Managed a team of 5" → "Managed a team of 12" is FORBIDDEN (changes the
  metric).

Term-substitution is the #1 failure mode. These swaps look innocent but are
FORBIDDEN: "Paid social campaigns on Meta and TikTok" → "Programmatic
campaigns..."; "Email marketing program" → "Lifecycle marketing program"
(unless source says "lifecycle"); "OpenShift deployments" → "OpenShift
Kubernetes deployments"; "AWS infrastructure" → "AWS and GCP
infrastructure". Test: for every noun in your rewrite that names a tool,
technology, marketing channel, or methodology, verify it (or a direct R1
alias) appears in the source bullet OR in the source résumé's
SKILLS/EXPERIENCE text. If not, the noun was fabricated — revert.

Additive-qualifier test: strip the source bullet to its key nouns and
verbs; strip your rewrite the same way. Every noun in the rewrite must
either match a source noun or be a generic English word. If you introduced
a new SPECIFIC noun, remove it.

**R11. Anti-generic rewrite — applies ONLY when ALL three triggers match.**
- Trigger 1 — generic verb: the bullet's first word is one of: led,
  delivered, implemented, developed, managed, maintained, orchestrated,
  enhanced, ensured, executed, contributed, supported, drove, championed,
  established, coordinated.
- Trigger 2 — ≥2 filler phrases: "best practices", "at scale",
  "leveraging", "enhancing capabilities", "across multiple teams",
  "infrastructure automation", "cloud engineering practices",
  "modernization", "transformation initiatives", "cutting-edge",
  "enterprise-grade", "scalable"/"reliable"/"efficient"/"robust" (isolated).
- Trigger 3 — zero specific anchors: no digit sequence, no named tool/product
  appearing verbatim in the candidate's SKILLS section or another bullet of
  the same role, no proper noun.

When all three match, rewrite by substituting filler phrases with specific
nouns drawn from (a) other bullets of the same role, or (b) the SKILLS
section when the generic phrase unambiguously refers to a tool category
there. Every noun you introduce must appear verbatim (or as an R1 alias) in
one of those two places. Do not combine or merge bullets (R3 still applies).
If any trigger fails, R11 is inert — apply only R1-R10.

Example — all three triggers match: Source: "Implemented CI/CD and
Infrastructure-as-Code best practices across multiple teams." Verb
"Implemented" is generic; fillers = 2 ("best practices", "across multiple
teams"); anchors = 0. SKILLS lists "GitHub Actions, Terraform"; same role
mentions "GoodLeap Payments". Rewrite: "Built GitHub Actions CI/CD
pipelines and Terraform IaC for the GoodLeap Payments release across
engineering teams."

## Order of operations

1. Read the job posting. Identify the top 5-8 skills, responsibilities, and
   qualifications it emphasizes.
2. For each bullet in each role in the résumé, classify as KEEP, OPTIMIZE,
   or DROP per R8. Think creatively about connections — "building internal
   tools" is relevant to most engineering roles, "mentoring" to any senior
   role, "writing documentation" to any role valuing communication.
3. Reorder surviving bullets within each role: most job-relevant first.
4. Write the summary last, grounding it in the final bullet set. Build the
   skills array from source evidence only.

## Hard constraints (apply silently — do not narrate)

- No scope qualifiers not present in the source: "at scale", "large-scale",
  "enterprise-grade", "high-throughput", "world-class", "mission-critical",
  "multi-region", "global" (as an impact qualifier), "petabyte".
- No banned summary phrases (R6 list).
- No derived durations. Never compute "X years"/"a decade"/"over X years"
  from date ranges; include a duration only if that exact phrase is
  literally in the source.
- No invented numbers. Every digit-sequence in the output must appear in
  the source (shorthand 75K↔75000 allowed); never derive new percentages,
  multipliers, or headcounts.
- All source roles preserved (R4); skills traceable to source (R7); no
  term-substitution introducing job-description nouns (R10).

`scripts/validate.mjs` checks the banned-phrase, scope-qualifier,
derived-duration, and invented-number rules deterministically — see SKILL.md
Step 3. If it reports a violation, fix your JSON directly (you have full
context on why the rule matters) and re-run it until clean.
