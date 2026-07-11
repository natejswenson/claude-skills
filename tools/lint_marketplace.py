#!/usr/bin/env python3
"""Repo-wide consistency lint for the Claude Code plugin marketplace manifest.

Skill-agnostic, offline, deterministic, stdlib-only. Validates
``.claude-plugin/marketplace.json`` at the repo root against the four
per-skill ``.claude-plugin/plugin.json`` files it lists:

  1. ``marketplace.json`` exists and parses as JSON.
  2. Every ``plugins[].source`` resolves (relative to the repo root) to a
     directory containing a ``.claude-plugin/plugin.json``.
  3. Aggregate bidirectional membership: the set of ``skills/*/`` directories
     that contain a ``plugin.json`` is exactly the set of ``plugins[].name``
     entries -- catches both an orphan marketplace entry (no backing
     directory) and an orphan plugin directory (no marketplace entry, which
     would otherwise merge green yet be non-installable).
  4. Per-row three-way name tie: for EVERY entry, ``entry.name`` ==
     ``basename(entry.source)`` == the ``plugin.json["name"]`` found at that
     source. This is implemented as a genuinely separate per-row check from
     (3) -- a cross-wired manifest (e.g. entry "resume" pointing at
     ./skills/devlog, paired with entry "devlog" pointing at ./skills/resume)
     satisfies the aggregate set-equality in (3) while failing this, because
     (3) only compares NAME SETS and (2)/the "backing directory" existence
     check only checks that SOME plugin.json is present -- neither ties one
     entry's name to that same entry's actual source. See the design doc
     (docs/plans/2026-07-10-marketplace-plugin-topology-design.md, S-1) for
     the concrete cross-wire example this closes.
  5. Uniqueness: no two ``plugins[]`` entries share the same ``name``.

Deliberately unconditional (no short-circuit) -- run this on every PR via the
dedicated `ci / marketplace` workflow. See the design doc, Components/S2, for
why a paths-filter short-circuit here would open an escape hole instead of
saving anything (the check is sub-second).
"""

from __future__ import annotations

import glob
import json
import os
import sys


def _read_json(path: str) -> tuple[dict | None, str | None]:
    """Read and parse a JSON file. Returns (data, error) -- exactly one is None."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except (OSError, FileNotFoundError):
        return None, f"missing file: {path}"
    try:
        return json.loads(text), None
    except json.JSONDecodeError as exc:
        return None, f"JSON parse error in {path}: {exc}"


def lint_marketplace(repo_root: str) -> dict:
    """Validate ``<repo_root>/.claude-plugin/marketplace.json``.

    Returns a dict: ``{"errors": [str, ...]}`` -- empty list means clean.
    """
    errors: list[str] = []

    marketplace_path = os.path.join(repo_root, ".claude-plugin", "marketplace.json")
    data, err = _read_json(marketplace_path)
    if err is not None:
        return {"errors": [err]}

    plugins = data.get("plugins", [])

    # Uniqueness (check 5).
    seen_names: dict[str, list[str]] = {}
    for entry in plugins:
        seen_names.setdefault(entry.get("name"), []).append(entry.get("source"))
    for name, sources in seen_names.items():
        if len(sources) > 1:
            errors.append(
                f"duplicate plugins[].name {name!r} used by {len(sources)} entries: "
                f"{sources} -- each name must be unique"
            )

    # Per-entry source resolution (check 2) + per-row three-way tie (check 4).
    entry_names_with_valid_source: set[str] = set()
    for entry in plugins:
        entry_name = entry.get("name")
        source = entry.get("source")
        if not isinstance(source, str):
            errors.append(f"entry {entry_name!r} has a non-string source: {source!r}")
            continue

        source_dir = os.path.normpath(os.path.join(repo_root, source))
        source_plugin_json = os.path.join(source_dir, ".claude-plugin", "plugin.json")

        if not os.path.isdir(source_dir) or not os.path.isfile(source_plugin_json):
            errors.append(
                f"entry {entry_name!r} source {source!r} does not resolve to a "
                f"directory containing .claude-plugin/plugin.json"
            )
            continue

        entry_names_with_valid_source.add(entry_name)

        # Check 4: per-row three-way tie, independent of the aggregate check below.
        source_basename = os.path.basename(source_dir)
        source_plugin_data, source_err = _read_json(source_plugin_json)
        source_plugin_name = source_plugin_data.get("name") if source_err is None else None

        if entry_name != source_basename or source_plugin_name != entry_name:
            errors.append(
                "per-row name mismatch for entry %r: entry.name=%r, "
                "basename(source)=%r, plugin.json.name at source=%r -- all "
                "three must be identical (this is what catches a cross-wired "
                "manifest that the aggregate membership check alone would miss)"
                % (entry_name, entry_name, source_basename, source_plugin_name)
            )

    # Aggregate bidirectional membership (check 3).
    dirs_with_plugin_json = {
        os.path.basename(os.path.dirname(os.path.dirname(p)))
        for p in glob.glob(os.path.join(repo_root, "skills", "*", ".claude-plugin", "plugin.json"))
    }
    entry_names = {e.get("name") for e in plugins}

    orphan_dirs = dirs_with_plugin_json - entry_names
    orphan_entries = entry_names - dirs_with_plugin_json
    if orphan_dirs or orphan_entries:
        parts = []
        if orphan_dirs:
            parts.append(f"directories with plugin.json but no marketplace entry: {sorted(orphan_dirs)}")
        if orphan_entries:
            parts.append(f"marketplace entries with no backing directory: {sorted(orphan_entries)}")
        errors.append("bidirectional membership mismatch -- " + "; ".join(parts))

    return {"errors": errors}


def main(argv) -> int:
    """CLI entry point. ``--repo-root PATH`` defaults to CWD (CI runs from repo root)."""
    args = list(argv)
    repo_root = os.getcwd()
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--repo-root":
            if i + 1 >= len(args):
                sys.stderr.write("error: --repo-root requires a value\n")
                return 2
            repo_root = args[i + 1]
            i += 2
            continue
        if arg.startswith("--repo-root="):
            repo_root = arg.split("=", 1)[1]
            i += 1
            continue
        if arg in ("-h", "--help"):
            sys.stdout.write("usage: lint_marketplace.py [--repo-root PATH]\n")
            return 0
        i += 1

    result = lint_marketplace(repo_root)

    print(f"Marketplace root: {repo_root}")
    if result["errors"]:
        for err in result["errors"]:
            print(f"  [FAIL] {err}")
        print("RESULT: FAIL")
        return 1

    print("  [PASS] marketplace.json exists and parses")
    print("  [PASS] every plugins[].source resolves to a plugin.json-containing directory")
    print("  [PASS] bidirectional membership (skills/*/plugin.json <-> marketplace.json entries)")
    print("  [PASS] per-row three-way name tie (entry.name == basename(source) == plugin.json.name)")
    print("  [PASS] plugins[].name values are unique")
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
