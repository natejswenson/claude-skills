# ghostwriter evals

A regression net so future features don't silently break existing behavior. Three tiers, split by
determinism and cost. Design: `docs/plans/2026-06-28-ghostwriter-evals-design.md`.

| Tier | What it catches | Runs in CI? | Cost |
|---|---|---|---|
| **1. Skill-contract** (`../tests/test_skill_contract.py` + `../skill-invariants.json`) | Deletion/rename of a prose guardrail; broken script/template refs; version↔CHANGELOG drift | **Yes** (offline) | $0 |
| **2. Behavioral** (`run_eval.py` + `scenarios.json`) | The agent *disobeys* a guardrail (publishes w/o approval, skips the gate, accepts auto-posting) | No (manual) | LLM, capped |
| **3. Voice judge** (`voice_judge.py` + `fixtures/`) | Drafts drifting from voice (AI tells, em-dashes, reflexive CTAs, rule-of-three) | No (manual) | LLM, capped |

Tier 1 is the actual "break nothing" guarantee and runs free in `ci / ghostwriter`. Tiers 2–3 use a
live agent / judge model, so they're **on-demand** and **cost-capped** — run them when adding a
feature to spot-check behavior before promoting.

## Running

```bash
cd skills/ghostwriter

# Tier 1 — runs with the normal test suite (offline, $0)
.venv/bin/python -m pytest tests/test_skill_contract.py

# Tier 2 — behavioral scenarios
.venv/bin/python evals/run_eval.py --mock            # $0 plumbing smoke (no grading)
.venv/bin/python evals/run_eval.py --seeds 3         # live: needs claude CLI + ANTHROPIC_API_KEY

# Tier 3 — voice judge
.venv/bin/python evals/voice_judge.py --draft evals/fixtures/good-draft.md --mock   # $0
.venv/bin/python evals/voice_judge.py --draft drafts/2026-07-01-foo.md             # live
```

## Cost control (`budget.py`)

Every live path goes through a **pre-call hard cap** (`--max-spend`, default $0.50) that aborts
*before* a call that would breach it, prints a spend estimate up front, and supports `--mock`
(zero API calls). CI has no `ANTHROPIC_API_KEY`, so `mock_enabled()` forces mock there even without
the flag — CI can never spend. The harness *logic* is unit-tested in mock mode
(`../tests/test_evals_harness.py`), so it stays under the repo's 100% coverage bar; the live API
call sites are marked `# pragma: no cover`.

## Safety

The behavioral harness runs with **no real LinkedIn credentials** and grades the agent's *tool-use
intent* (did it emit a non-dry-run `linkedin_post.py` call?) rather than letting it execute — so an
eval testing "does it publish without approval" can never actually publish.

## Adding cases

- **A new guardrail** → add an entry to `../skill-invariants.json` (regex + rationale).
- **A new behavior to verify** → add a scenario to `scenarios.json` and, if needed, a detector to
  `BEHAVIORS` in `run_eval.py`.
- **A new AI-tell** → add a regex to `_AI_TELL_CHECKS` in `voice_judge.py` and a fixture.
