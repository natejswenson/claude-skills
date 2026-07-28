Claude Code v2.1.214 fixed a permission bug: Edit(src/**) was auto-approving writes to any src/ directory in the tree, not just the one at your repo root. If you scope Edit permissions in CI, go check your rules today.

---

That's not a cosmetic bug. A rule scoped to protect one directory was silently granting write access repo-wide, unattended, in CI. Exactly the failure mode you'd never catch by just reading the rule text.

---

How to check: any dir/** allow rule written before v2.1.214 (Edit(src/**), Write(config/**), whatever you've scoped) needs a re-test. Confirm it only fires inside <cwd>/dir, not on a nested dir/ anywhere else in the tree.

---

Same release cycle (v2.1.212) also capped WebSearch calls and subagent spawns at 200 each per session, tunable via CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION / CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION. Set them explicitly for long autonomous jobs.

---

Scoped permission rules are a claim about what your CI can touch. Re-verify that claim on every major version bump, not once when you first write the rule.
