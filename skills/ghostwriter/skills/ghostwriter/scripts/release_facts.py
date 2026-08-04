#!/usr/bin/env python3
"""Read the facts a release brochure is allowed to claim.

A brochure is marketing, which is exactly why it needs a harder evidence rule
than a normal card, not a softer one. Every figure on it — the version, the
date, the install line, the rule the skill refuses to break — is read here from
the released artifact, so the card cannot quietly round a version up, invent a
capability, or advertise an install command that does not work.

It returns facts. It never writes a card: composing one is judgment, and a
brochure this script could generate would be the same brochure every time.

    release_facts.py <skill> [--repo <path>] [--json <out>]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

MARKETPLACE = "claude-skills"


def _run(args: list[str]) -> str | None:
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def repo_slug(repo: Path) -> str | None:
    url = _run(["git", "-C", str(repo), "remote", "get-url", "origin"])
    if not url:
        return None
    m = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url.strip())
    return m.group(1) if m else None


def latest_release(slug: str, skill: str) -> dict | None:
    """The newest published release whose tag belongs to this skill.

    Tags are namespaced `<skill>-v<version>`, so a repo-wide "latest" is the
    wrong answer in a monorepo — it would advertise another skill's version
    under this skill's name.
    """
    raw = _run([
        "gh", "release", "list", "--repo", slug, "--limit", "200",
        "--json", "tagName,name,publishedAt,isDraft,isPrerelease",
    ])
    if not raw:
        return None
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        return None

    prefix = f"{skill}-v"
    mine = [
        r for r in rows
        if r.get("tagName", "").startswith(prefix)
        and not r.get("isDraft") and not r.get("isPrerelease")
    ]
    if not mine:
        return None

    def key(r):
        v = r["tagName"][len(prefix):]
        parts = re.findall(r"\d+", v)[:3]
        return tuple(int(p) for p in parts) + (0,) * (3 - len(parts))

    return max(mine, key=key)


def skill_dir(repo: Path, skill: str) -> Path:
    return repo / "skills" / skill / "skills" / skill


def frontmatter_description(md: Path) -> str | None:
    if not md.exists():
        return None
    text = md.read_text(encoding="utf-8")
    m = re.search(r"^---\n(.*?)\n---", text, re.S)
    if not m:
        return None
    d = re.search(r"^description:\s*(.+?)(?=\n\w+:|\Z)", m.group(1), re.S | re.M)
    return " ".join(d.group(1).split()) if d else None


def one_rule(md: Path) -> str | None:
    """The bolded line under `## The one rule`.

    This is the sentence that makes a skill more than a prompt, so it is the
    single most honest thing a brochure can lead with. Absent, the brochure
    says so rather than inventing a promise.
    """
    if not md.exists():
        return None
    text = md.read_text(encoding="utf-8")
    m = re.search(r"^##+\s*The one rule\s*\n+(.+?)(?=\n##|\Z)", text, re.S | re.M)
    if not m:
        return None
    bold = re.search(r"\*\*(.+?)\*\*", m.group(1), re.S)
    if not bold:
        return None
    return " ".join(bold.group(1).split())


def changelog_bullets(repo: Path, skill: str, version: str) -> list[str]:
    """Top-level bullets of this version's entry — raw material, not copy."""
    path = repo / "skills" / skill / "CHANGELOG.md"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"^##\s*\[{re.escape(version)}\].*?\n(.*?)(?=^##\s*\[|\Z)",
                  text, re.S | re.M)
    if not m:
        return []
    # A bullet wraps across lines, so its continuation has to be folded in
    # before markup is stripped — reading line by line cut every bullet at the
    # first newline and left dangling `**` in the middle of a sentence.
    bullets: list[str] = []
    for line in m.group(1).splitlines():
        if re.match(r"^-\s+", line):
            bullets.append(re.sub(r"^-\s+", "", line))
        elif bullets and line.startswith(("  ", "\t")) and line.strip():
            bullets[-1] += " " + line.strip()
        elif not line.strip():
            continue

    out = []
    for b in bullets:
        b = re.sub(r"\*\*(.+?)\*\*", r"\1", b, flags=re.S)
        b = re.sub(r"`(.+?)`", r"\1", b, flags=re.S)
        out.append(" ".join(b.split()))
    return out


def table(headers: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return ""
    w = [max(len(h), *(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    line = lambda c: "| " + " | ".join(str(x).ljust(w[i]) for i, x in enumerate(c)) + " |"
    return "\n".join([line(headers), "|" + "|".join("-" * (x + 2) for x in w) + "|",
                      *(line(r) for r in rows)])


TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "card-template-brochure.html"

# Judgment slots stay marked; factual slots are substituted. Repeatability is the
# whole point: a card assembled by hand is a card whose version, date and install
# steps depend on whoever assembled it.
_QUOTE_OLD = (
    '<div class="q">The one rule, quoted from the skill rather than softened\n'
    '          into something easier to promise.</div>'
)


def scaffold(facts: dict) -> str:
    """The brochure with every FACTUAL slot already filled from the release."""
    html = TEMPLATE.read_text(encoding="utf-8")
    rule = facts.get("oneRule") or "TODO - this skill declares no one rule"
    # A quote that runs long stops being a pull quote; keep the leading clause.
    if len(rule) > 96:
        rule = rule.split(" — ")[0].split(", and ")[0].rstrip(".,") + "."

    subs = [
        ('<div class="eyebrow">Eyebrow Label · <span class="no">No. 001</span></div>',
         f'<div class="eyebrow">Release · <span class="no">{facts["skill"]}</span></div>'),
        ('<span class="fval">v0.0.0</span>', f'<span class="fval">v{facts["version"]}</span>'),
        ('<span class="fval">2026-01-01</span>', f'<span class="fval">{facts["published"]}</span>'),
        ('<code class="cmdbar">the --actual first command</code>',
         f'<code class="cmdbar">{facts["installSteps"][0]}</code>'),
        ('<code class="cmdbar">the --actual second command</code>',
         f'<code class="cmdbar">{facts["installSteps"][1]}</code>'),
        (_QUOTE_OLD, f'<div class="q">{rule}</div>'),
        ('<span class="fcap">how it was proven</span>',
         '<span class="fcap">tag read back from origin</span>'),
        ('<h1>One headline <span class="sig">pivot.</span></h1>',
         '<h1>TODO headline <span class="sig">pivot.</span></h1>'),
    ]
    for old, new in subs:
        html = html.replace(old, new, 1)
    return html


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("skill")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--scaffold", dest="scaffold_out",
                    help="write a brochure card with every FACTUAL slot filled "
                         "from the release; judgment slots stay marked TODO")
    args = ap.parse_args(argv)

    repo = Path(args.repo).resolve()
    skill = args.skill

    sdir = skill_dir(repo, skill)
    if not sdir.exists():
        print(f"release_facts: no skill at {sdir}", file=sys.stderr)
        return 1

    slug = repo_slug(repo)
    if not slug:
        print("release_facts: no github remote on this repo", file=sys.stderr)
        return 1

    rel = latest_release(slug, skill)
    if not rel:
        print(f"release_facts: {skill} has no published release — "
              "a brochure for an unreleased skill would advertise something "
              "nobody can install", file=sys.stderr)
        return 1

    version = rel["tagName"].split("-v", 1)[1]
    md = sdir / "SKILL.md"
    facts = {
        "skill": skill,
        "version": version,
        "tag": rel["tagName"],
        "published": (rel.get("publishedAt") or "")[:10],
        "releaseUrl": f"https://github.com/{slug}/releases/tag/{rel['tagName']}",
        "repo": slug,
        # BOTH steps, always. `/plugin install` alone does nothing until the
        # marketplace is added, so a card showing only the second line
        # advertises a command that does not work — the exact failure this
        # module exists to prevent.
        "marketplace": f"/plugin marketplace add {slug}",
        "install": f"/plugin install {skill}@{MARKETPLACE}",
        "installSteps": [
            f"/plugin marketplace add {slug}",
            f"/plugin install {skill}@{MARKETPLACE}",
        ],
        "description": frontmatter_description(md),
        "oneRule": one_rule(md),
        "changelogBullets": changelog_bullets(repo, skill, version),
    }

    print(table(["Fact", "Value"], [
        ["skill", facts["skill"]],
        ["version", facts["version"]],
        ["tag", facts["tag"]],
        ["published", facts["published"] or "—"],
        ["install step 1", facts["installSteps"][0]],
        ["install step 2", facts["installSteps"][1]],
        ["one rule", "present" if facts["oneRule"] else "— (none declared)"],
        ["changelog bullets", str(len(facts["changelogBullets"]))],
    ]))

    if facts["oneRule"]:
        print(f"\none rule: {facts['oneRule']}")
    if facts["changelogBullets"]:
        print("\nRaw material — rewrite, never paste:")
        for b in facts["changelogBullets"][:6]:
            print(f"  - {b[:110]}")

    if args.scaffold_out:
        out = Path(args.scaffold_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(scaffold(facts), encoding="utf-8")
        print(f"\nwrote {args.scaffold_out} — facts filled; compose the plate, "
              "the headline, the standfirst and the proof figure")

    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(facts, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
