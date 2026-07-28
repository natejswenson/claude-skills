#!/usr/bin/env python3
"""Repo-level meta-lint: every skill must ship a baseline eval set.

Skill-agnostic, offline, deterministic, stdlib-only. Runs unconditionally in
``ci / marketplace`` alongside lint_marketplace.py.

The per-skill baselines are what catch behavioral degradation, but nothing makes
a NEW skill ship with one, and nothing stops an existing declaration rotting into
a lie (a fixture deleted, a test renamed, a corpus glob that quietly matches
nothing). Those failures are invisible: the skill's own CI stays green because
the assertions simply never run. This lint is the backstop.

For every ``skills/<name>/skills/<name>/``, it checks:

  1. ``skill-invariants.json`` exists and parses.
  2. ``prose`` is present and non-empty -- the guardrail contract.
  3. ``baseline`` is present and non-empty -- the baseline eval set.
  4. Every baseline entry has ``id``, ``kind``, ``test`` and ``rationale``,
     with unique ids.
  5. The named ``test`` file exists AND sits where that skill's test runner will
     actually discover it. A baseline test that CI never invokes is worse than
     no baseline: it reads as coverage.
  6. Every declared ``fixtures`` path exists.
  7. Every ``corpus_glob`` matches at least ``min_corpus`` files, and a corpus
     entry declares ``min_corpus`` at all. This is the anti-vacuity rule: a
     corpus check that iterates an empty glob passes while asserting nothing.

Usage:
    python tools/lint_baseline.py [repo-root]
"""

from __future__ import annotations

import glob
import json
import os
import sys

#: Where each test runner actually looks. A declared test outside these paths is
#: never executed, so the baseline it claims to enforce does not exist.
#:   pytest      -> testpaths = ["tests"], default `test_*.py` discovery
#:   node --test -> "tests/**/*.test.mjs"   (devlog, shipflow)
#:   run-tests   -> "scripts/**/*.test.mjs" (resume)
RUNNER_PATTERNS = (
    "tests/test_*.py",
    "tests/*.test.mjs",
    "tests/**/*.test.mjs",
    "scripts/*.test.mjs",
    "scripts/**/*.test.mjs",
)

REQUIRED_ENTRY_KEYS = ("id", "kind", "test", "rationale")


def _discoverable(rel_test: str) -> bool:
    """True if `rel_test` matches a path some test runner actually scans."""
    import fnmatch

    normalized = rel_test.replace(os.sep, "/")
    for pattern in RUNNER_PATTERNS:
        # fnmatch treats "*" as crossing "/", so compare segment counts too:
        # "tests/test_x.py" must not satisfy "scripts/**/*.test.mjs".
        if fnmatch.fnmatch(normalized, pattern):
            return True
    return False


def lint_skill(skill_root: str, name: str) -> list[str]:
    """Return a list of problems for one skill (empty == clean)."""
    problems: list[str] = []
    manifest_path = os.path.join(skill_root, "skill-invariants.json")

    if not os.path.isfile(manifest_path):
        return [
            f"{name}: missing skill-invariants.json at {manifest_path}. Every "
            f"skill needs one -- it is the guardrail contract AND the baseline "
            f"declaration (see CLAUDE.md, 'Adding a new skill')."
        ]

    try:
        with open(manifest_path, "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{name}: skill-invariants.json is unreadable or invalid JSON: {exc}"]

    if not manifest.get("prose"):
        problems.append(
            f"{name}: skill-invariants.json has no non-empty 'prose' array. The "
            f"prose guardrails are the only thing protecting SKILL.md rules that "
            f"no code enforces."
        )

    baseline = manifest.get("baseline")
    if not baseline:
        problems.append(
            f"{name}: skill-invariants.json has no non-empty 'baseline' array. "
            f"Every skill needs at least one deterministic, offline baseline eval "
            f"pinned against real past-run artifacts."
        )
        return problems

    seen_ids: set[str] = set()
    for index, entry in enumerate(baseline):
        label = f"{name}: baseline[{index}]"
        if not isinstance(entry, dict):
            problems.append(f"{label} is not an object")
            continue

        missing = [k for k in REQUIRED_ENTRY_KEYS if not entry.get(k)]
        if missing:
            problems.append(f"{label} is missing required key(s): {', '.join(missing)}")
            continue

        entry_id = entry["id"]
        label = f"{name}: baseline '{entry_id}'"
        if entry_id in seen_ids:
            problems.append(f"{label} has a duplicate id")
        seen_ids.add(entry_id)

        rel_test = entry["test"]
        test_path = os.path.join(skill_root, rel_test)
        if not os.path.isfile(test_path):
            problems.append(f"{label} names a test that does not exist: {rel_test}")
        elif not _discoverable(rel_test):
            problems.append(
                f"{label} names a test at '{rel_test}', which no test runner in "
                f"this repo discovers. It would never run, so the baseline it "
                f"declares does not actually gate anything. Expected one of: "
                f"{', '.join(RUNNER_PATTERNS)}"
            )

        for rel_fixture in entry.get("fixtures", []):
            if not os.path.exists(os.path.join(skill_root, rel_fixture)):
                problems.append(
                    f"{label} declares a fixture that does not exist: {rel_fixture}"
                )

        corpus_glob = entry.get("corpus_glob")
        if entry["kind"] == "corpus" and corpus_glob is None:
            problems.append(f"{label} has kind 'corpus' but declares no corpus_glob")
        if corpus_glob is not None:
            min_corpus = entry.get("min_corpus")
            if not isinstance(min_corpus, int) or min_corpus < 1:
                problems.append(
                    f"{label} declares corpus_glob '{corpus_glob}' but no positive "
                    f"integer min_corpus. Without a floor, a glob that matches "
                    f"nothing passes while asserting nothing."
                )
            else:
                matches = glob.glob(os.path.join(skill_root, corpus_glob), recursive=True)
                excluded = tuple(entry.get("exclude_suffixes", []))
                if excluded:
                    matches = [m for m in matches if not m.endswith(excluded)]
                if len(matches) < min_corpus:
                    problems.append(
                        f"{label} corpus_glob '{corpus_glob}' matches "
                        f"{len(matches)} file(s), below its declared min_corpus of "
                        f"{min_corpus}."
                    )

    return problems


def discover_skills(repo_root: str) -> list[tuple[str, str]]:
    """Yield (skill_root, name) for every skills/<name>/skills/<name>/ directory."""
    outer = os.path.join(repo_root, "skills")
    found = []
    for name in sorted(os.listdir(outer)):
        nested = os.path.join(outer, name, "skills", name)
        if os.path.isdir(nested):
            found.append((nested, name))
    return found


def main(argv: list[str]) -> int:
    repo_root = argv[1] if len(argv) > 1 else "."
    skills = discover_skills(repo_root)

    if not skills:
        print(f"lint_baseline: no skills found under {repo_root}/skills", file=sys.stderr)
        return 1

    all_problems: list[str] = []
    for skill_root, name in skills:
        all_problems.extend(lint_skill(skill_root, name))

    if all_problems:
        print(f"lint_baseline: {len(all_problems)} problem(s) across {len(skills)} skill(s)\n")
        for problem in all_problems:
            print(f"  ✗ {problem}")
        return 1

    print(f"lint_baseline: OK -- {len(skills)} skill(s) declare a baseline eval set")
    for _, name in skills:
        print(f"  ✓ {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
