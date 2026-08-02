# Recipes — per ecosystem

**No version numbers are frozen in this file, on purpose.** Published research
puts the typical workflow 7+ months behind the actions it uses, and a hardcoded
table starts rotting the day it ships. Resolve every ref live:

```bash
node bin/ghfactory.js resolve actions/checkout actions/setup-node
```

Then pin the SHA with a `# vX` trailing comment. Every skeleton below assumes the
anatomy in `anatomy.md` (masthead, `permissions:`, `concurrency:`,
`timeout-minutes:`) and shows only what differs.

## Node

```yaml
      - uses: actions/checkout@<sha>          # vN
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>        # vN
        with:
          node-version: "24"
          cache: npm                          # caches ~/.npm, NOT node_modules
          cache-dependency-path: package-lock.json
      - run: npm ci                           # never `npm install` in CI
      - run: npm test
```

- **`npm ci`, not `npm install`** — lockfile-exact, and it wipes `node_modules`.
- **`cache: npm` caches `~/.npm`.** People "fix" this by hand-rolling an
  `actions/cache` on `node_modules`; don't. Two caches then fight over one path.
- **pnpm: `pnpm/action-setup` must come BEFORE `setup-node`.** setup-node shells
  out to `pnpm store path` to find the directory to cache, so the reverse order
  fails with `Unable to locate executable file: pnpm` — which reads like a
  setup-node bug and is not. Install with `pnpm install --frozen-lockfile`.
- **pnpm and yarn must pass `cache:` explicitly.** Recent setup-node narrowed
  automatic caching to npm only, so a pnpm repo that upgraded silently lost its
  cache.
- **Yarn Berry** uses `--immutable`; `--frozen-lockfile` is the Yarn 1 spelling.
  With zero-installs (`.yarn/cache` committed) drop the cache input entirely.

## Python

```yaml
      - uses: astral-sh/setup-uv@<sha>        # vN
        with:
          enable-cache: true
          cache-dependency-glob: "uv.lock"    # not every .py file
          python-version: ${{ matrix.python }}
      - run: uv sync --locked --all-extras --dev
      - run: uv run pytest -q
```

- **`setup-uv` installs the interpreter too** — adding `actions/setup-python`
  alongside it just doubles setup time.
- **`uv sync --locked`** fails when the lock is stale (the `npm ci` analogue).
  `--frozen` skips the check; `--locked` is what CI wants.
- **Poetry**: `pipx install poetry` *before* `setup-python` (same ordering reason
  as pnpm), then `cache: poetry`. Include `poetry check --lock` — it catches
  "someone edited pyproject.toml and never regenerated the lock", which otherwise
  surfaces months later as an unreproducible build.
- **pip**: recent `setup-python` **removed the `pip-install` input**; a copied
  snippet that passes it now fails on an unrecognised input. Install explicitly.

## Go

```yaml
      - uses: actions/setup-go@<sha>          # vN
        with:
          go-version: "1.26"                  # QUOTED — see below
          cache-dependency-path: go.sum
      - run: go mod tidy -diff                # fails if go.mod/go.sum would change
      - run: go vet ./...
      - run: go test -race ./...
```

- **Quote the version.** Unquoted, `go-version: 1.20` is the YAML float `1.2` and
  setup-go installs Go 1.2. Same family as the Norway problem.
- **setup-go caches by default.** Every pre-v4 blog post adds a manual
  `actions/cache` on `~/go/pkg/mod` — delete it, it is now redundant and harmful.
- `-race` roughly triples test time; split it into its own job rather than
  raising `timeout-minutes`.

## Rust

- `Swatinem/rust-cache` beats a hand-rolled cache: it keys on the lockfile **and**
  the rustc version and prunes stale `target/`.
- `cargo build --locked` / `cargo test --locked` — fails rather than silently
  updating `Cargo.lock`.
- `dtolnay/rust-toolchain` publishes refs named after *toolchains*, not action
  versions — `@stable`, not `@v1`. Worth a comment; it looks wrong otherwise.
- **Rust caches are huge** (1–2 GB per leg). A few matrix legs consume the entire
  10 GB repo cache budget and start LRU-evicting everything else.

## Java

- `gradle/actions/setup-gradle` replaced the archived `gradle-build-action`.
- Set `validate-wrappers: true` — it checksums `gradle-wrapper.jar`, a committed
  binary nobody reviews. Real supply-chain control.
- `cache-read-only: ${{ github.ref != 'refs/heads/main' }}` so only the default
  branch writes the cache — the documented mitigation for PR cache poisoning.
- Do **not** also set `cache: gradle` on `setup-java`; two actions then save
  overlapping paths. For Maven, `cache: maven` on `setup-java` *is* the right
  place. Add `-B --no-transfer-progress` or the log is unreadable.

## Docker → GHCR

- `cache-from: type=gha` / `cache-to: type=gha,mode=max`, but **`mode=max` can
  evict your other caches** — it counts against the same 10 GB LRU budget. Near
  the cap, use `type=registry` instead; it doesn't touch the Actions budget.
- Gate the login step on `github.event_name != 'pull_request'` — a fork PR's token
  is read-only and the login fails.
- Multi-arch via QEMU is 5–20× slower than a native arm64 runner. If the build is
  slow, that's the fix, not more cache.

## GitHub Pages

Use the first-party `configure-pages` → `upload-pages-artifact` → `deploy-pages`
flow. It replaces `peaceiris/actions-gh-pages` and every "force-push to gh-pages
with a PAT" snippet — those need `contents: write`, pollute history, and give you
no deployment record or rollback.

- `concurrency: { group: pages, cancel-in-progress: false }` — a **literal** group,
  not `github.ref`. One site; deploys queue rather than race.
- Deploy needs `pages: write` + `id-token: write` and no `contents:` write at all.
- **Settings → Pages → Source must be "GitHub Actions"**, or `deploy-pages` fails
  with a 404 that reads like a permissions problem. Say this in the output.

## Publishing

Prefer **trusted publishing** (npm, PyPI) — no standing credential exists to leak.
No `NODE_AUTH_TOKEN`, no `--provenance` (npm adds provenance automatically), no
`with:` block on `pypa/gh-action-pypi-publish`.

Split build from publish: the build job needs no permissions; only the small
publish job holds `id-token: write` and passes the environment approval gate.
`concurrency` with `cancel-in-progress: false` — never cancel a publish.

## Reusable workflows

- `workflow_call` input types are **`string` | `number` | `boolean` only**.
  `type: choice` is `workflow_dispatch`-only and is a hard validation error here —
  the most common mistake when converting a dispatch workflow into a reusable one.
- A reusable workflow does **not** inherit the caller's `env:`. Pass it as input.
- `jobs.<id>.uses` and `jobs.<id>.steps` are mutually exclusive.
- Permissions can only be **narrowed**. Declare them on the calling job.
- Local calls use `./.github/workflows/x.yml` with **no** `@ref`; cross-repo calls
  require one — pin a tag or SHA, never `@main`.
- Prefer explicit `secrets:` over `secrets: inherit`, which hands over everything.

## Scheduled

- **Randomize the minute.** `0 0 * * *` is the most congested minute on the
  platform; runs queued there are delayed or dropped. Pick a non-zero minute.
- **Always pair with `workflow_dispatch:`** — a schedule runs only the default
  branch's copy, so you cannot test a cron change on a branch.
- Cron is UTC with no DST handling, delivery is best-effort and may be skipped, and
  on public repos schedules are **auto-disabled after 60 days of inactivity**.
  Never build something requiring exactly-once nightly execution.

## Gotchas that bite everywhere

- **`on:` is YAML 1.1's boolean `true`.** GitHub's parser handles it; your tooling
  may not. Never "fix" it by quoting — that breaks GitHub.
- **`if:` is already an expression context** — `if: ${{ … }}` is redundant, and
  mixing literal text with `${{ }}` there produces surprising truthiness.
- **`if: always()` swallows cancellation** — it runs even when you cancel the run.
  `!cancelled()` is almost always what was meant.
- **A path-filtered required check never becomes green** on a PR that doesn't touch
  those paths, and blocks the merge forever. Either leave `pull_request`
  unfiltered and short-circuit inside the job, or don't make it required.
- **Matrix legs must produce unique artifact names**; same-name uploads collide.
