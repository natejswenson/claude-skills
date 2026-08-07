# Security — the rules no linter catches

`ghfactory verify` already runs actionlint and zizmor, which between them catch
template injection (including inside `actions/github-script`'s `script:`),
excessive permissions, unpinned actions, credential persistence, `secrets:
inherit`, and spoofable bot conditions. **Do not re-derive those by hand — run
the ladder.**

This file is only the rules **neither tool can check**. They are the ones that
have to be right at authoring time.

## 1. Whether a permission set is *sufficient*

zizmor flags too much. Nothing flags too little — that surfaces at runtime as an
opaque 403. And the moment a `permissions:` block exists it is **exhaustive**:
anything unlisted becomes `none`, which is the top cause of "it worked until we
added permissions".

| Task | Needs |
|---|---|
| checkout, read code | `contents: read` |
| push a commit, branch or tag | `contents: write` |
| create a Release *and its tag* | `contents: write` — releases are `contents`, not `deployments` |
| comment on a PR | `pull-requests: write` |
| comment on an issue | `issues: write` |
| create a check run | `checks: write` |
| set a commit status | `statuses: write` |
| upload SARIF / CodeQL | `security-events: write` |
| publish to GitHub Packages | `packages: write` + `contents: read` |
| publish to npm/PyPI via trusted publishing | `id-token: write` + `contents: read` — **not** `packages:` |
| build provenance attestation | `attestations: write` + `id-token: write` + `contents: read` |
| deploy to Pages | `pages: write` + `id-token: write` |
| download an artifact from another run | `actions: read` |
| any OIDC token | `id-token: write` — never granted by default |

`id-token` has no `read` value. Grant at the **job** level; job-level replaces
workflow-level rather than merging.

## 2. `pull_request_target` + a checkout of the PR head

**The single most important rule here.** zizmor flags the trigger as dangerous;
it does **not** correlate "dangerous trigger + head-sha checkout", which is the
actual kill.

`pull_request_target` reads the workflow from the base branch — which sounds safe
and is why people reach for it — but runs with a **full read-write token and every
repository secret**, automatically, on a PR from any fork, from anyone.

So the moment you check out the head, everything after it is arbitrary code
execution holding every secret: `npm install` runs *their* lifecycle scripts,
`pytest` imports *their* `conftest.py`, a Dockerfile build runs *their* Dockerfile.

**Default to `pull_request`.** A fork PR gets a read-only token and zero secrets;
the isolation is structural, not a policy you can misconfigure.

If you use `pull_request_target`, **never check out the PR head.** A workflow that
labels, triages or comments does not need the code.

### Never emit `allow-unsafe-pr-checkout`

`actions/checkout` v7 **refuses by default** to check out a fork PR head under
`pull_request_target` or `workflow_run`, and the escape hatch is deliberately
named to be obvious in review. Two consequences:

- **Never generate `allow-unsafe-pr-checkout: true`.** If a requested workflow
  seems to need it, that is the signal to restructure into the `workflow_run`
  split below — not to add the flag.
- If upgrading a repo to checkout v7 makes a workflow start failing on fork PRs,
  checkout is telling you that workflow was exploitable. Fix the workflow; do not
  pin back to v6.

The protection covers fork PR refs only. It does **not** cover `git fetch`,
`gh pr checkout`, an unrelated third-party repo, or running a downloaded artifact.

### The safe replacement — the two-workflow `workflow_run` split

This is the correct default when a fork PR genuinely needs a write token. The
untrusted code runs unprivileged; results cross as an artifact; the privileged
half never checks out PR code.

Five details are load-bearing. Dropping any one reintroduces the vulnerability:

1. `if: github.event.workflow_run.event == 'pull_request'` — otherwise the
   privileged half can be triggered through some other event.
2. `&& github.event.workflow_run.conclusion == 'success'` — a failed run's
   artifacts are still downloadable.
3. Download to `${{ runner.temp }}`, **never the workspace** — the artifact is
   attacker-authored; extracting it next to a `Makefile` a later step invokes is
   a re-entry.
4. **Validate everything read out of the artifact as data.** Parse the PR number
   with `Number.isInteger`; never interpolate artifact contents into a command,
   and never render attacker markdown as a comment body — construct your own.
5. `actions: read` plus `run-id:`, because the artifact belongs to another run.

### If you use a label gate instead

A label is **sticky**. Maintainer labels commit `abc`; attacker pushes `def`; the
label is still set and the next run executes unreviewed code with secrets. A
label gate is only safe with a companion job that **removes the label on every
`synchronize`**. Add `npm ci --ignore-scripts` and an environment-scoped secret to
shrink the blast radius — they do not eliminate it.

## 3. Any action input that is a code sink

zizmor knows a catalog of injection sinks derived from CodeQL's models. It cannot
know about an action published after that model was built.

**Treat any action input named `script`, `run`, `command`, `expression`, `args`,
`options` or `eval` as a code sink** and env-indirect anything untrusted going
into it — exactly as you would for a `run:` block.

## 4. Untrusted data into `$GITHUB_ENV` or `$GITHUB_PATH`

A newline in the value lets an attacker append `LD_PRELOAD=`, `NODE_OPTIONS=` or
`BASH_ENV=` and get execution in a *later* step. `$GITHUB_PATH` is worse — prepend
a directory and shadow `npm`, `git` or `python` for every step that follows.

Use `$GITHUB_OUTPUT`, which is scoped to the step, and pass the value onward
through `env:`.

## 5. Which contexts are attacker-controlled

GitHub's docs no longer publish an exhaustive list; they give a suffix heuristic —
contexts ending in `body`, `default_branch`, `email`, `head_ref`, `label`,
`message`, `name`, `page_name`, `ref`, `title`.

Treat as untrusted: every `github.event.*.body` / `.title` / `.message` / `.name`,
`github.event.pull_request.head.ref` and `.label` and `.repo.*`,
`github.event.*.user.login`, `github.head_ref`, `github.event.inputs.*`
(a `workflow_dispatch` input is attacker-controlled by anyone with write access),
and `github.actor`.

Safe to interpolate: `github.repository`, `github.repository_owner`, `github.sha`,
`github.run_id`, `github.run_number`, `github.run_attempt`, `github.job`,
`github.event_name`, `github.workspace`, `github.server_url`.

Email fields are constrained but **not** safe — an address can contain `$` and
backticks.

## 6. Whether the SHA you pinned belongs to that repo

The tj-actions/changed-files compromise worked by **mutating tags** to point at
attacker code — which is why pinning to a full 40-char SHA is the rule. But a SHA
from a *fork* also looks like a valid pin.

zizmor's `impostor-commit` audit catches this, and it is an **online** audit
requiring `GH_TOKEN` — `ghfactory verify` runs zizmor offline for speed, so this one
is not covered by the default ladder. For a workflow handling secrets or
publishing, run zizmor online once:

```bash
GH_TOKEN=$(gh auth token) uvx zizmor@latest <file…>
```

## 7. Never restore a cache in a release or publish workflow

A run can restore caches from its own ref, the base branch, **and the default
branch** — so the cache is shared mutable state that crosses the branch boundary.

The attack needs no write access to `main`: get execution on any branch, extract
the Actions Runtime Token, flood the cache past the 10 GB repo limit so LRU
evicts the legitimate entries, then re-create the vacated key with a poisoned
payload. The next release run on `main` restores it and executes attacker code
holding production secrets. This is how `angular/dev-infra` was compromised.

So: a release job builds from scratch. No `cache:` input.

And **never cache `node_modules`, `venv` or `vendor` directly** — cache the
package manager's *download* cache and let `npm ci` re-verify against the
lockfile. A poisoned download cache still has to defeat the lockfile hash; a
poisoned `node_modules` does not. (Caching the installed tree is also wrong for
plain correctness: postinstall scripts don't re-run and native modules stay built
against the previous ABI.)

zizmor's `cache-poisoning` audit catches the release-workflow case. The
`node_modules`-vs-download-cache distinction it does not.

## 8. Prefer no standing credential at all

Trusted publishing (npm, PyPI) and cloud OIDC remove the long-lived token
entirely — there is nothing in repo secrets left to exfiltrate. npm generates
provenance automatically under trusted publishing; do **not** add `--provenance`
or `NODE_AUTH_TOKEN`.

The binding is to the **workflow file path**, so renaming the file breaks
publishing with a confusing 403. Say so when generating one.

For cloud OIDC, the trust policy lives outside the repo and no linter can see it.
The recurring mistake is a wildcard `sub` claim — scope it to the exact repo,
ref and environment.
