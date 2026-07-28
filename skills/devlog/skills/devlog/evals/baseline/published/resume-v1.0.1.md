---
title: "How to tell which package in a monorepo actually needs a release"
date: 2026-07-11
project: resume
version: v1.0.1
tags: [git, monorepo, semver, release-engineering, tagging, path-filter, ci-cd]
summary: "Two sibling packages in the same repo both got a patch release from the exact same commit. Here's the git-tag-plus-path-filter technique that tells you which packages actually need a release when one commit touches all of them."
---

## Shipped

Four sibling skills in one repo all got a `.claude-plugin/plugin.json` and a `CHANGELOG.md` entry in the same two commits, part of [converting the whole repo into a Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces). Two of those four, resume and a sibling skill, immediately got a real git release tag cut for it (`resume-v1.0.1`); the other two didn't, at least not yet. That split is the actual topic here: how do you decide, mechanically, which package in a monorepo genuinely needs a release when one commit touches several of them at once?

## The problem with one shared commit

A monorepo with several independently versioned packages runs into this the first time an infrastructure change lands in one commit that legitimately touches every package: a CI migration, a lint rule, a shared build script. Every package's code changed, so does every package deserve a new release? A single repo-wide version number sidesteps the question by making everything one release, but that has its own cost. As one team's writeup on this puts it plainly: with a unified version "we would have to 'build the world' every time there is an update to the repo," which stopped being feasible once "some of the components take >15min to build" ([Streamdal: Monorepos: Version, Tag, and Release Strategy](https://streamdal.com/blog/monorepos-version-tag-and-release-strategy/)). Per-package versioning avoids that, but only if there's a mechanical way to tell "this package's code changed" from "this package needs a new tag."

## Build it: a tag prefix per package

The standard fix, and the one used here, is a distinct tag prefix per package instead of one shared version:

```text
resume-v1.0.0
resume-v1.0.1
ghostwriter-v0.8.0
ghostwriter-v0.8.1
```

Per the same writeup, this "is not valid semantic versioning but it is a common approach to tagging multiple components that live within the same repository." It buys three things a single repo version can't: only the changed package needs its build/release pipeline to run, tag volume stays proportional to actual releases per package instead of exploding with every commit, and `git tag -l 'resume-v*'` alone answers "what has resume shipped" without touching any other package's history.

## Build it: deciding when a shared commit earns a package its own tag

A prefix alone doesn't answer the actual question, though: given a commit that touches multiple packages, which of those packages' tag prefixes should include it? The rule that works is a path filter checked against the commit range since that package's last tag, not against the commit in isolation:

```python
#!/usr/bin/env python3
"""Finds git tags that represent a real release for one package in a
monorepo: a tag matching that package's prefix, with commits since the
previous matching tag that actually touch that package's path."""
import subprocess
import sys


def run(*args):
    return subprocess.run(
        ["git", *args], cwd=sys.argv[1], capture_output=True, text=True, check=True
    ).stdout.strip()


def tags_for_prefix(prefix):
    all_tags = run("tag", "--sort=creatordate").splitlines()
    return [t for t in all_tags if t.startswith(prefix)]


def find_releases(prefix, path_filter):
    tags = tags_for_prefix(prefix)
    releases = []
    for i, tag in enumerate(tags):
        prev_tag = tags[i - 1] if i > 0 else None
        commit_range = f"{prev_tag}..{tag}" if prev_tag else tag
        commits = run("log", "--oneline", commit_range, "--", path_filter)
        if commits:
            releases.append((tag, prev_tag, commits.splitlines()))
    return releases


if __name__ == "__main__":
    prefix, path_filter = sys.argv[2], sys.argv[3]
    for tag, prev_tag, commits in find_releases(prefix, path_filter):
        print(f"{tag} (since {prev_tag or 'repo start'}): {len(commits)} commit(s)")
        for c in commits:
            print(f"  {c}")
```

The `-- <path_filter>` on `git log` is what makes this a per-package answer instead of a repo-wide one: it only returns commits in that range that touched files under the package's own directory, silently dropping commits that only touched other packages.

## Use it, then verify it against a real shared commit

To see this handle the actual scenario, a two-package repo with a shared infrastructure commit at the end:

```text
$ git log --oneline --all
c96fcda feat: convert all packages into plugin-installable format
50e7884 feat: initial api and worker
dcb1bb6 feat(api): add health check endpoint
$ git tag
api-v1.0.0
api-v1.1.0
api-v1.2.0
worker-v1.0.0
worker-v1.1.0
```

`api-v1.2.0` and `worker-v1.1.0` were both tagged at `c96fcda`, the shared commit. Running the script for each package:

```text
$ python3 find_releases.py . api-v packages/api
api-v1.0.0 (since repo start): 1 commit(s)
  50e7884 feat: initial api and worker
api-v1.1.0 (since api-v1.0.0): 1 commit(s)
  dcb1bb6 feat(api): add health check endpoint
api-v1.2.0 (since api-v1.1.0): 1 commit(s)
  c96fcda feat: convert all packages into plugin-installable format

$ python3 find_releases.py . worker-v packages/worker
worker-v1.0.0 (since repo start): 1 commit(s)
  50e7884 feat: initial api and worker
worker-v1.1.0 (since worker-v1.0.0): 1 commit(s)
  c96fcda feat: convert all packages into plugin-installable format
```

The shared commit `c96fcda` correctly shows up as the release-triggering commit for both packages, each under its own path filter, while `dcb1bb6` (an api-only commit) never appears in worker's list at all. That's the whole answer: a package gets a release when its own path filter finds real commits in the range, whether or not other packages' commits happen to share the same hash.

## Gotchas

**A version bump in a manifest file is not the same signal as a release tag.** In the run that prompted this, four sibling packages all got their `plugin.json` version field and `CHANGELOG.md` bumped in the exact same commit. Two of them also got a fresh git tag cut for that bump; two didn't, at least not at the time of writing. Anything downstream that keys off "which packages were released" by scanning git tags, the way the script above does, would miss those two entirely, even though their manifest files genuinely changed. If a release-detection process reads tags, a manifest bump with no matching tag is invisible to it, whether that's an oversight or a deliberate choice to hold that package's release for later. Either way, don't assume a changed version field implies a cut release; check the tag. It's the same risk the [npm blog's monorepo writeup](https://blog.npmjs.org/post/186494959890/monorepos-and-npm.html) names directly: "asking humans to remember to do this across a large collection of packages... is asking for trouble." A tag-scanning script doesn't get to forget; a human bumping four manifest files by hand can, and evidently did for two of them.

**A shared commit read as duplicate content the first time through, not as two separate release stories.** Writing this pair of posts, the two package's commit ranges resolved to the exact same two commits, because that's genuinely what happened. The first pass toward the two writeups almost retold the whole marketplace-conversion story twice. The fix was deciding up front which package's post owns the full narrative and giving the other one a genuinely different angle instead, the technique this post covers, rather than two copies of the same walkthrough with the package name swapped.

## Sources

- [Streamdal: Monorepos: Version, Tag, and Release Strategy](https://streamdal.com/blog/monorepos-version-tag-and-release-strategy/) — the per-package tag-prefix pattern and why a single repo-wide version breaks down.
- [npm Blog Archive: Monorepos and npm](https://blog.npmjs.org/post/186494959890/monorepos-and-npm.html) — on the risk of lockstep versioning: "asking humans to remember to do this across a large collection of packages... is asking for trouble," the human-error case for a mechanical check over a manual convention.
- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) — background on the plugin conversion that produced the shared commit this post's example is drawn from.

## Changelog

- fix: nest SKILL.md under skills/<name>/ so plugins are discoverable (#32) ([cd9bc5b](https://github.com/natejswenson/claude-skills/commit/cd9bc5b94453c2f70632e1c784e8fcf878dfda7a))
- feat: convert claude-skills into a Claude Code plugin marketplace (#30) ([7537f10](https://github.com/natejswenson/claude-skills/commit/7537f103c73283a82e5432e99f552d206ccb808c))
