# eval — skillfactory

| Measure             | Value                                                                                                                      |
|---------------------|----------------------------------------------------------------------------------------------------------------------------|
| skill graded        | skillfactory                                                                                                               |
| contract sources    | skills/skillfactory/skills/skillfactory/SKILL.md, skills/skillfactory/skills/skillfactory/skill-invariants.json, CLAUDE.md |
| clauses extracted   | 32                                                                                                                         |
| clauses examined    | 9 of 32                                                                                                                    |
| trace events        | 416                                                                                                                        |
| findings (machine)  | 17                                                                                                                         |
| findings (judgment) | 0                                                                                                                          |
| citations rejected  | 0                                                                                                                          |

## Findings

| Severity | Finding    | Clause                                                                | Event           | What                                                                                                           |
|----------|------------|-----------------------------------------------------------------------|-----------------|----------------------------------------------------------------------------------------------------------------|
| high     | f-fa23ff8b | skill-bfb1b27b (skills/skillfactory/skills/skillfactory/SKILL.md:14)  | e2 (line 13)    | no "using the skillfactory skill" announcement anywhere in the run                                             |
| medium   | f-0d5c2fca | press-13f05150 (skills/skillfactory/skills/skillfactory/SKILL.md:278) | e343 (line 654) | reshapes output in the shell: `cd /private/tmp/claude-501/-Users-natejswenson-localrepo-claude-skills/c596ab6… |
| medium   | f-30154636 | press-13f05150 (skills/skillfactory/skills/skillfactory/SKILL.md:278) | e339 (line 648) | reshapes output in the shell: `cd /private/tmp/claude-501/-Users-natejswenson-localrepo-claude-skills/c596ab6… |
| medium   | f-3c887e69 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e22 (line 47)   | dumps a file into the conversation: `cat evals/baseline/skills/tally/README.md`                                |
| medium   | f-4c753e34 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e48 (line 99)   | dumps a file into the conversation: `cat evals/inputs/demo.spec.json`                                          |
| medium   | f-52094709 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e321 (line 616) | dumps a file into the conversation: `cat evals/baseline/MANIFEST.json`                                         |
| medium   | f-54ddc826 | press-13f05150 (skills/skillfactory/skills/skillfactory/SKILL.md:278) | e77 (line 151)  | reshapes output in the shell: `cd /private/tmp/claude-501/-Users-natejswenson-localrepo-claude-skills/c596ab6… |
| medium   | f-65c71d27 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e46 (line 92)   | dumps a file into the conversation: `cat skill-invariants.json`                                                |
| medium   | f-7078d63f | press-13f05150 (skills/skillfactory/skills/skillfactory/SKILL.md:278) | e341 (line 651) | reshapes output in the shell: `cd /private/tmp/claude-501/-Users-natejswenson-localrepo-claude-skills/c596ab6… |
| medium   | f-7d4dcc90 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e332 (line 634) | dumps a file into the conversation: `cat skills/smith/skills/smith/evals/baseline/skills/tally/README.md`      |
| medium   | f-86729093 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e32 (line 64)   | dumps a file into the conversation: `cat skills/smith/README.md`                                               |
| medium   | f-93d2e822 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e26 (line 51)   | dumps a file into the conversation: `cat brand/voice-core.md`                                                  |
| medium   | f-a1c559b5 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e9 (line 21)    | dumps a file into the conversation: `cat skills/press/skills/press/targets.json`                               |
| medium   | f-d9e756c5 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e20 (line 39)   | dumps a file into the conversation: `cat brand/laws.md`                                                        |
| medium   | f-e1e74ab9 | press-783a6ddf (skills/skillfactory/skills/skillfactory/SKILL.md:273) | e28 (line 54)   | dumps a file into the conversation: `cat skills/press/skills/press/brand/components.md`                        |
| medium   | f-f0646032 | press-13f05150 (skills/skillfactory/skills/skillfactory/SKILL.md:278) | e323 (line 623) | reshapes output in the shell: `cd /private/tmp/claude-501/-Users-natejswenson-localrepo-claude-skills/c596ab6… |
| medium   | f-f61ee1f4 | press-8f262e00 (skills/skillfactory/skills/skillfactory/SKILL.md:297) | e2 (line 13)    | no "using the skillfactory skill" announcement anywhere in the run                                             |

| Severity | count |
|----------|-------|
| high     | 1     |
| medium   | 16    |

## The clauses nobody examined

23 of 32 clauses had no probe and no judgment finding. Their absence from Findings above means nothing was checked, not that nothing was wrong.

| Severity | Clause         | Source                                                          | Text                                                                                             |
|----------|----------------|-----------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| critical | rule-87292e96  | skills/skillfactory/skills/skillfactory/SKILL.md:35             | Say which rung you reached, and never claim more.                                                |
| high     | house-59ab724c | CLAUDE.md:27                                                    | Keep this file current in the same PR.                                                           |
| high     | house-d75b3fa7 | CLAUDE.md:20                                                    | add a `CHANGELOG.md` entry in the same change. A `dev → main` merge with no bump is a no-op rel… |
| high     | house-ffae6e92 | CLAUDE.md:17                                                    | A release is cut by a version bump, not by a merge.                                              |
| high     | inv-01b85cf5   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | Without `--trap-command` the generated test fails                                                |
| high     | inv-03f96fd5   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | fails until a real run is frozen                                                                 |
| high     | inv-0dbd701c   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | Wait for the answer before asking the next                                                       |
| high     | inv-115ea544   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | Never overwrite an existing skill                                                                |
| high     | inv-632adfeb   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | never silently proceed as though it made no difference                                           |
| high     | inv-7b28d752   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | an unresolvable anchor aborts before the first byte is written                                   |
| high     | inv-d678d24f   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | keep the H1 exactly the\s+skill name                                                             |
| high     | inv-d6f17209   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | only takes effect when an admin runs it                                                          |
| high     | inv-fe657281   | skills/skillfactory/skills/skillfactory/skill-invariants.json:1 | Never weaken a check to get green                                                                |
| high     | skill-1dae0e7d | skills/skillfactory/skills/skillfactory/SKILL.md:228            | `check-spec` and the baseline trap exist to be argued with, not edited. Fix the input. -         |
| high     | skill-37df8a89 | skills/skillfactory/skills/skillfactory/SKILL.md:211            | same** change: releases here are publish-on-merge, so a follow-up promotion to fix release note… |
| high     | skill-62038661 | skills/skillfactory/skills/skillfactory/SKILL.md:224            | Say which rung you reached. -                                                                    |
| high     | skill-9ed01840 | skills/skillfactory/skills/skillfactory/SKILL.md:91             | Never ask about anything in them.                                                                |
| high     | skill-db1638ff | skills/skillfactory/skills/skillfactory/SKILL.md:219            | , so the agent writes it. What the baseline *catches* is judgment, not a template. ## Rules tha… |
| high     | skill-f5094be9 | skills/skillfactory/skills/skillfactory/SKILL.md:124            | Name the skill after the job, never a metaphor.                                                  |
| medium   | press-2485e417 | skills/skillfactory/skills/skillfactory/SKILL.md:282            | Report in tables, with named columns.                                                            |
| medium   | press-6b84d65d | skills/skillfactory/skills/skillfactory/SKILL.md:289            | Never claim a visual result without the artifact.                                                |
| medium   | press-932da062 | skills/skillfactory/skills/skillfactory/SKILL.md:270            | Keep the machinery invisible.                                                                    |
| medium   | press-c24d0465 | skills/skillfactory/skills/skillfactory/SKILL.md:287            | Show, don't describe.                                                                            |

## What the machine did not decide

| Probe                 | Cannot decide                                                                                                                                          |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| file-contents-in-chat | a file printed by a tool other than Bash, or a dump the agent then summarised — the clause is about what the reader sees, and only some of that is in… |
| announce-once         | whether an announcement that exists is phrased the way the skill asked for                                                                             |
| pipeline-reshaping    | whether the script could reasonably have returned that shape — sometimes the shell really is the right tool                                            |
| pr-into-main          | a PR opened through the GitHub MCP tools or the web UI rather than the gh CLI                                                                          |
| brand-bypass          | whether the edit actually touched a generated region — the trace records the path, not the bytes. This is a proxy, and it under-reports by design rat… |
| done-without-freeze   | a softer overclaim — "basically finished", "ready to ship" — which reads the same to a user and only judgment catches                                  |
