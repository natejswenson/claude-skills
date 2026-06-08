# Security policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public GitHub issue.

- **Email:** open a GitHub security advisory at https://github.com/natejswenson/devlog/security/advisories/new
- **Response time:** target within 72 hours

Please do not file public issues, post on social media, or share PoCs publicly until a fix has shipped.

## Scope

In scope:
- The published npm package `@natjswenson/devlog` (any version)
- The CLI (`bin/devlog.js`)
- The Claude Code skill (`SKILL.md`)
- The Vite preview app (`preview/`)
- The React drop-in components (`examples/react/`)

Out of scope:
- The user's own `daily-dev-log` repo content (that's on the user)
- The user's GitHub account, gh CLI, or local dev environment
- The Claude Code product itself
- Vulnerabilities that require an attacker to already have arbitrary code execution on the user's machine
- Social engineering, phishing, or attacks on the npm registry / GitHub itself

## Threat model

### Trust boundaries

The package crosses three trust boundaries:

1. **npm → adopter's machine.** The package is distributed via the npm registry. Adopters trust npm not to ship a tampered tarball. Out of our scope; defense relies on npm's signing and provenance.

2. **`config.json` → shell commands.** The Claude Code skill (`SKILL.md`) reads `~/.claude/skills/devlog/config.json` and uses values in shell commands run via Claude's bash tool. The skill's Step 0.5 enforces strict allowlist validation on every field BEFORE interpolation, and instructs the LLM to single-quote all values when interpolating. This is the most security-critical boundary.

3. **`daily-dev-log` repo content → adopter's deployed site.** Markdown entries published via `/devlog` are fetched from `raw.githubusercontent.com` and rendered by `react-markdown` 9.x. Raw HTML is disabled. URLs are restricted to `http(s)://`, `mailto:`, `#`, and relative paths via an explicit `urlTransform`.

### Attacker capabilities

| Attacker | Has access to | Out of reach |
|---|---|---|
| Random LinkedIn reader | npm tarball, GitHub repo, README | Adopter's machine, gh token, dev-log content |
| Adopter who edits config.json | Their own filesystem, gh token | Other adopters' machines |
| Contributor with PR rights to dev-log repo | Markdown content rendered by adopter's site | Adopter's local files, gh token |

### What's protected

- **Command injection in the CLI:** every shell call that includes user input uses `spawnSync` with argv arrays (no shell). The four hardcoded `execSync` calls (`gh --version`, `gh auth status`, `gh api user --jq .login`, `git config --global user.name`) take no user input.

- **Command injection via the skill:** the skill validates every config value against an allowlist before interpolation, instructs the LLM to single-quote every value, and uses `git -C <path>` form rather than `cd <path> && git ...` to reduce shell-composition surface.

- **Path traversal:** project keys, manifest filenames, and project paths are all pattern-matched. Project paths additionally cannot start with `-` (would be parsed as a flag). Manifest filenames must match `^[a-zA-Z0-9._-]+\.md$`.

- **XSS via markdown:** `react-markdown` 9 with `skipHtml`, plus an explicit `urlTransform` allowlisting only `http(s)://`, `mailto:`, `#`, and relative URLs. Schemes like `data:`, `blob:`, `javascript:`, `vbscript:`, `file:` are replaced with `#`.

- **Prototype pollution via frontmatter:** the parser uses `Object.create(null)` and only writes to keys in `{title, date, project, summary}` — so `__proto__: x` in a hostile entry has no effect.

- **Schema confusion:** every external JSON document (manifest, parsed env-var projects array) is validated against a strict schema before use. Malformed input is rejected, not "fixed."

- **Demo-mode side effects in production:** the global `window.fetch` override is gated to `import.meta.env.DEV`. Production builds without env vars show a clear "Setup required" screen instead of broken-looking entries.

- **Env var leakage to client-side:** the CLI passes only `VITE_DEVLOG_*` variables (plus `PATH`/`HOME`/etc. needed for Vite to run) to the spawned vite process. Adopter's other `VITE_*` shell vars do NOT leak into the preview bundle.

- **Vite dev server exposure:** explicit `server.host: 'localhost'` + `cors: false`. The dev server cannot be reached from other machines on the LAN by default.

- **Atomic config writes:** `config.json` is written to a sibling `.tmp.<pid>` file then renamed atomically. Readers never see partial state.

- **Tight `.gitignore`:** excludes `.npmrc`, `.env*`, `*.pem`, `*.key`, `.vscode/`, `.idea/`, `coverage/` so future contributors can't accidentally publish secrets via the `files` whitelist in package.json.

- **Pinned dependencies:** every dependency is pinned to an exact version (no `^` ranges) to eliminate resolution drift across installs.

### What's NOT protected (intentional risk acceptance)

- **Adopter editing config.json with malicious values.** The skill validates at runtime and refuses to run on bad input — but a sufficiently determined user can bypass any client-side guard by directly running shell commands themselves. The package can't protect against the adopter attacking their own machine.

- **Adopter installing a typosquatted package.** Always verify the scope is `@natjswenson` (no extra `e`).

- **GitHub raw URL paths.** A manifest entry's `file` field is restricted to `^[a-zA-Z0-9._-]+\.md$`, but the project key is part of the URL path. The schema validator on project keys rejects `..`, `/`, and other traversal characters.

## Reproducible attack scenarios that have been ruled out

Each of the following has been tested against the current code and shown to be ineffective. Reports of these scenarios will be acknowledged but treated as "already addressed."

1. `gitAuthor: "Nate\"; rm -rf ~; #"` in config.json → blocked by Step 0.5 validation in skill, rejected by CLI prompt validator.
2. `path: "/tmp/$(id)"` in config.json → blocked by SHELL_METACHARS regex.
3. `targetRepo: "-h"` or `--template <evil-repo>` → rejected by `^[a-z0-9][a-z0-9._-]*$` regex requiring leading alphanumeric.
4. `__proto__: pwned` in entry frontmatter → ignored by allowlist + `Object.create(null)` parser.
5. `[click me](javascript:alert(1))` in entry markdown → react-markdown's default sanitizer + our `urlTransform` rewrite to `#`.
6. `[click](data:text/html,<script>...)` in entry markdown → rewritten to `#` by `urlTransform`.
7. Manifest entry with `file: "../../../other-repo/secret.md"` → rejected by `^[a-zA-Z0-9._-]+\.md$` schema.
8. Concurrent editor seeing a half-written `config.json` → atomic rename guarantees readers see either the old or new file, never a partial write.
9. `VITE_API_KEY=secret npx ... preview` leaking through into the preview bundle → blocked by env-var allowlist in CLI.

## Audit history

| Date | Version | Audit | Result |
|---|---|---|---|
| 2026-05-01 | 0.1.5 → 0.1.7 | 6-agent siege (Boundary Attacker, Insider Threat, Infrastructure Prober, Betrayed Consumer, Fresh Attacker, Chain Analyst) | 1 Critical + 3 High + 7 Medium + 4 Low → 0 Critical + 0 High + 0 Medium-Active in 0.1.7 |
