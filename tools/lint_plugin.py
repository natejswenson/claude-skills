#!/usr/bin/env python3
"""Tier-1.5 consistency lint for a skill's Claude Code plugin manifest.

Skill-agnostic, offline, deterministic, stdlib-only (no pyyaml). Checks that
``<skill-dir>/.claude-plugin/plugin.json`` stays in lockstep with the skill's
existing sources of truth (SKILL.md frontmatter, package.json):

  1. ``plugin.json`` exists and parses as JSON.
  2. ``plugin.json["name"]`` equals the skill directory's basename, which must
     also equal SKILL.md frontmatter ``name:``. ``plugin.json["name"]`` is
     NEVER sourced from ``package.json["name"]`` -- see the design doc
     (docs/plans/2026-07-10-marketplace-plugin-topology-design.md, F1) for why
     package.json names are unreliable for this (e.g. scoped npm names,
     typos, or simply absent for python skills).
  3. Every *present* version field (plugin.json, SKILL.md frontmatter,
     package.json) is mutually equal -- not just pairwise against one
     "resolved" value. A skill with only plugin.json + SKILL.md must have
     those two equal; a skill with all three must have all three equal.

Run in CI as the Tier-1.5 gate for every skill, right after score_skill.py.
"""

from __future__ import annotations

import json
import os
import sys

from score_skill import parse_frontmatter


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


def lint_plugin(skill_dir: str) -> dict:
    """Check ``<skill_dir>``'s plugin.json against its other sources of truth.

    Returns a dict::

        {
            "errors": [str, ...],   # empty means clean
            "name": {"plugin_json": str|None, "dir": str, "skill_md": str|None},
            "versions": {"plugin.json": str, "SKILL.md": str, "package.json": str},
            # ^ only keys for fields that are actually present in this skill
        }
    """
    errors: list[str] = []
    dir_base = os.path.basename(os.path.normpath(skill_dir))

    plugin_json_path = os.path.join(skill_dir, ".claude-plugin", "plugin.json")
    plugin_data, plugin_err = _read_json(plugin_json_path)
    if plugin_err is not None:
        errors.append(plugin_err)
        plugin_data = {}

    # SKILL.md and package.json live one level deeper than plugin.json, at
    # <skill_dir>/skills/<dir_base>/ -- Claude Code's plugin auto-discovery only
    # scans skills/<subdir>/SKILL.md, never a root-level SKILL.md. plugin.json
    # itself stays at <skill_dir>/.claude-plugin/ per the manifest convention.
    nested_skill_dir = os.path.join(skill_dir, "skills", dir_base)

    skill_md_path = os.path.join(nested_skill_dir, "SKILL.md")
    try:
        with open(skill_md_path, "r", encoding="utf-8") as fh:
            skill_md_text = fh.read()
    except (OSError, FileNotFoundError):
        skill_md_text = ""
    fm = parse_frontmatter(skill_md_text)

    package_json_path = os.path.join(nested_skill_dir, "package.json")
    package_data: dict = {}
    if os.path.isfile(package_json_path):
        package_data, package_err = _read_json(package_json_path)
        if package_err is not None:
            errors.append(package_err)
            package_data = {}

    # --- Check 2: name ties (plugin.json.name == dir basename == SKILL.md name) ---
    plugin_name = plugin_data.get("name") if plugin_data else None
    skill_md_name = fm.get("name")
    name_info = {"plugin_json": plugin_name, "dir": dir_base, "skill_md": skill_md_name}

    if plugin_err is None:
        if plugin_name != dir_base or (skill_md_name is not None and skill_md_name != dir_base):
            errors.append(
                "name mismatch: plugin.json.name=%r, directory basename=%r, "
                "SKILL.md name=%r -- all three must be identical (never "
                "sourced from package.json.name)" % (plugin_name, dir_base, skill_md_name)
            )

    # --- Check 3: mutual equality across every PRESENT version field ---
    versions: dict[str, str] = {}
    if plugin_err is None and "version" in plugin_data:
        versions["plugin.json"] = plugin_data["version"]
    if "version" in fm:
        versions["SKILL.md"] = fm["version"]
    if "version" in package_data:
        versions["package.json"] = package_data["version"]

    distinct = set(versions.values())
    if len(distinct) > 1:
        rendered = ", ".join(f"{k}={v!r}" for k, v in versions.items())
        errors.append(f"version mismatch across present fields: {rendered}")

    return {"errors": errors, "name": name_info, "versions": versions}


def main(argv) -> int:
    """CLI entry point. Returns 0 if clean, 1 if any lint failure, 2 on usage error."""
    args = list(argv)
    skill_dir = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-h", "--help"):
            sys.stdout.write("usage: lint_plugin.py <skill-dir>\n")
            return 0
        if skill_dir is None:
            skill_dir = arg
        i += 1

    if skill_dir is None:
        sys.stderr.write("usage: lint_plugin.py <skill-dir>\n")
        return 2

    result = lint_plugin(skill_dir)

    print(f"Skill: {skill_dir}")
    if result["errors"]:
        for err in result["errors"]:
            print(f"  [FAIL] {err}")
        print("RESULT: FAIL")
        return 1

    print("  [PASS] plugin.json exists and parses")
    print("  [PASS] name ties (plugin.json / directory / SKILL.md all match)")
    print("  [PASS] all present version fields mutually equal:", result["versions"])
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
