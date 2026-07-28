---
title: "Folding a content repo into the site repo without breaking idempotent publishing"
date: 2026-07-19
project: devlog
version: v0.10.0
tags: [github-api, gh-cli, idempotency, cloudflare-pages, static-sites, content-pipeline, release-engineering, shell]
summary: "Moving generated content into a subfolder of the site repo turns every publish push into a deploy. The catch: your publisher's already-published check is full of path assumptions, and missing one silently re-plans your entire archive."
---

## Shipped

devlog v0.10.0 adds a `targetDir` setting: the publisher can now write its content tree into a subdirectory of the target repo instead of the repo root. That's the piece that let me delete a whole repo from my pipeline; devlog entries now land in `content/devlog/` inside the site repo itself, and the push that publishes them is the same push that deploys the site. The release also rewrote the cover style guide for the site's PRESS brand (including a fill floor for the hero illustration) and froze entry numbers at publish time so a backdated entry can't renumber the archive. This post is about the migration pattern: what an idempotent publisher checks before it writes, and every place a path prefix has to reach when the content moves.

## The two-repo tax

The old shape was a dedicated content repo. The generator pushed markdown, a manifest, and a cover PNG there; the site fetched it all at build time. Workable, but every publish needed a second step, an empty "rebuild" commit to the site repo, because [Cloudflare Pages triggers a deployment on commits to the production branch](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) of the repo it watches, and content landing in a *different* repo doesn't count.

Move the content into the site repo and that second step disappears. The site reads the files from disk at build time, and the publish push is the deploy trigger. The only real engineering is in the publisher: it has to stay idempotent when its target is no longer a repo root.

## The check that makes publishing idempotent

A release publisher should be safe to re-run. Mine plans work by listing what's already published and diffing against local git tags, one directory listing per project via the [GitHub contents API](https://docs.github.com/en/rest/repos/contents): `GET /repos/{owner}/{repo}/contents/{path}` returns an array of entries when `path` is a directory, and `ref` pins the branch. Through [`gh api`](https://cli.github.com/manual/gh_api) that's a one-liner, authenticated with your existing CLI login:

```bash
gh api "repos/OWNER/REPO/contents/PROJECT?ref=main" --jq '.[].name'
```

The Node version, with the two failure modes that matter kept distinct:

```js
// existing.mjs
import { spawnSync } from 'node:child_process';

// Which entry files already exist for one project.
// Returns { files: Set, status: 'ok' | 'empty' | 'failed' }.
export function fetchExistingEntries(repo, branch, projectKey, targetDir = '') {
  const contentPath = targetDir ? `${targetDir}/${projectKey}` : projectKey;
  const r = spawnSync('gh', ['api', `repos/${repo}/contents/${contentPath}?ref=${branch}`, '--jq', '.[].name'], { encoding: 'utf8' });
  if (r.status === 0) {
    return { files: new Set(r.stdout.split('\n').filter(Boolean)), status: 'ok' };
  }
  // 404 means "this project has no entries yet"; a normal state for a new
  // project, not an error. Anything else means the check itself failed and
  // the caller should know its already-published filter may be incomplete.
  if (/HTTP 404|Not Found/i.test(r.stderr)) {
    return { files: new Set(), status: 'empty' };
  }
  return { files: new Set(), status: 'failed' };
}
```

The `targetDir` parameter is the whole feature. Without it, moving content to `content/devlog/` means the check asks GitHub for `contents/ghostwriter` at the repo root, gets a 404, concludes "no entries yet", and the planner happily re-plans every release you've ever published. Fifty-five posts, in my case, all queued for regeneration against a publisher that would then refuse each one.

## Thread the prefix everywhere, and validate it

A path that ends up inside shell commands and API URLs earns strict validation at config time:

```js
// config.mjs
export function validateTargetDir(targetDir) {
  if (
    typeof targetDir !== 'string' ||
    !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(targetDir) ||
    targetDir.split('/').some((s) => s === '.' || s === '..')
  ) {
    throw new Error(`targetDir must be a relative path like "content/devlog": got ${JSON.stringify(targetDir)}`);
  }
  return targetDir;
}
```

Relative only, tight charset, no traversal segments. The regex alone would accept `..` as a "word", so the explicit segment check backs it up.

Then find every consumer of the old repo-root assumption. In my publisher there were three:

```js
// scan.mjs: the planner threads targetDir into the existence check and
// echoes it in its output, so the publish step can build paths from the
// same value instead of re-reading config.
const existing = fetchExistingEntries(config.targetRepo, branch, project.key, config.targetDir || '');
```

The other two live in the publish step. The writer's content root becomes `<clone>/<targetDir>` while git still operates on the clone root; and any "view it here" URL you print needs the prefix too:

```bash
git clone --depth=1 "https://github.com/OWNER/REPO.git" "$TMP/REPO"
CONTENT_ROOT="$TMP/REPO/content/devlog"   # writers target this
# ... write PROJECT/vX.Y.Z.md, PROJECT/manifest.json, PROJECT/vX.Y.Z.png under $CONTENT_ROOT ...
git -C "$TMP/REPO" add . && git -C "$TMP/REPO" commit -m 'devlog: add release entries'
git -C "$TMP/REPO" push origin main       # on Cloudflare Pages, this IS the deploy
```

## Cut over and verify

The safe order matters: land the content move in the site repo first, deploy it, and only then point the publisher at the new target; the existence check reads the target's live branch, so flipping config before the content exists there recreates the 404-means-empty re-planning problem on purpose.

After flipping, one scan tells you whether the prefix reached everywhere. This is the real output from my cutover:

```text
targetRepo: natejswenson/natejswenson.io | targetDir: content/devlog | branch: main
totalNewReleases: 5
  local-fitness: existenceCheck=ok new=0
  devlog: existenceCheck=ok new=2
  ghostwriter: existenceCheck=ok new=2
  resume: existenceCheck=ok new=0
  local-budget: existenceCheck=ok new=0
  personal: existenceCheck=ok new=0
```

Every project resolves `ok` through the subfolder, and the only "new" releases are genuinely untagged ones. If you see a fully published project reporting `new=<its entire history>`, the prefix missed the existence check.

## Gotchas

- **The missed-prefix failure is silent and looks like work to do.** Trap: any consumer of the old root-relative path that you didn't update. Symptom: not an error; the scan cheerfully reports your whole archive as new releases. Escape: after any path change, run the planner against the live target and assert the re-plan count is zero before letting anything publish.
- **404 is a state, not a failure.** Trap: treating every non-200 from the contents API the same. Symptom: either a brand-new project blocks publishing (404 treated as failure) or a real outage quietly re-plans everything (failure treated as empty). Escape: three-way status, as in `fetchExistingEntries` above; only 404 means empty.
- **The check is a filter, not the safety.** Trap: trusting the remote listing as the last line of defense. Symptom: a degraded check plus an overwrite-happy writer equals clobbered history. Escape: the writer itself must refuse to overwrite an existing entry against the fresh clone; then a failed existence check degrades to wasted planning, never to data loss.
- **zsh eats the `?` in the API path.** Trap: pasting `gh api repos/o/r/contents/x?ref=main` unquoted into zsh while debugging. Symptom: `no matches found: repos/...` before gh even runs, because `?` is a glob character. Escape: quote the whole endpoint argument; I hit this within an hour of shipping the feature.
- **Directory listings cap at 1,000 files.** Trap: one flat directory per project, forever. Symptom: the [contents API stops listing past 1,000 entries](https://docs.github.com/en/rest/repos/contents) and the existence filter goes blind. Escape: at that scale, switch the check to the Git Trees API; per-project directories buy a lot of headroom first.

## Sources

- [GitHub REST API: repository contents](https://docs.github.com/en/rest/repos/contents) — directory responses are arrays, `ref` pins the branch, 404 for missing paths, 1,000-file listing cap
- [Cloudflare Pages: branch build controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) — deployments trigger on commits to the production branch
- [gh api manual](https://cli.github.com/manual/gh_api) — authenticated API calls from the CLI, `--jq` for response filtering

## Changelog

- feat(devlog): targetDir — publish the content tree into a subdirectory of targetRepo (#84) ([5bfada2](https://github.com/natejswenson/claude-skills/commit/5bfada2bfd3d0a3826cb78c1eed0056d71436840))
- feat(devlog): PRESS cover style guide + frozen entry numbers ([2627a4c](https://github.com/natejswenson/claude-skills/commit/2627a4ce8cd59dfd95010e49f0a274c23abce289))
