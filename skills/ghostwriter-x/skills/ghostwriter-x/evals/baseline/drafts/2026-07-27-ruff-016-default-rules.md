Ruff 0.16 grew its default rule set from 59 rules to 413. I ran the old defaults and the new defaults over the same Python repo, nothing changed but the linter version: 9 errors became 138.

Here's how to take that upgrade without red-lining CI.

---

First, check whether it even hits you. If your config sets select or extend-select explicitly, the expanded defaults don't apply. Mine does, so my CI never moved.

The blast radius is every project running Ruff on defaults.

---

If it does hit you, freeze the old behavior in one block instead of scrambling. In ruff.toml:

[lint]
select = ["E4", "E7", "E9", "F"]

That's Astral's own revert recipe. Your pipeline goes green again while you decide, on your schedule.

---

Then measure before you fix anything:

ruff check --statistics

It prints a count per rule, so you triage by volume instead of scrolling 138 errors. Baseline what's left with ruff check --add-noqa, then turn on one category at a time. That's Ruff's documented onboarding path.

---

The part that gets missed: it isn't purely additive. 18 rules left the default set, including E402, E711, E712, E731 and F403.

On my repo the only thing the old defaults caught was 9 E402s. Under the new defaults, silent. Check what you stopped catching, not just what's new.
