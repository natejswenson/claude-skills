---
name: traefik
description: Manage a local Traefik Docker stack through its separately installed tk CLI. Use for "check Traefik health", "diagnose local HTTPS or DNS", "show service logs", "preview a rebuild", and "remove a service". Supports Codex and Claude Code with explicit stack resolution and scoped operations.
user_invocable: true
version: 0.1.0
---

# traefik

Use this shared skill as `$traefik` in Codex or `/traefik:traefik` in Claude Code.
Announce that you are using it. Resolve bundled files relative to this `SKILL.md`,
including when it is loaded from a plugin cache. Map file/shell tools to the host's
available tools; keep the host's sandbox and approval controls.

**Never operate a stack inferred from the plugin cache; resolve an explicit or verified stack and use its external tk CLI.**

## Resolve the stack

Run `node <loaded-skill-directory>/scripts/traefik.js detect` from the user's working
directory. Pass `--stack /absolute/checkout` when the user selected a stack. Read
the JSON result; never ask about anything in it that detection already establishes.
The helper probes only `tk capabilities --json`; it does not contact Docker.

Selection order is explicit `--stack`, `TRAEFIK_DIR`, a verified current-directory
ancestor, saved binding, then a `tk` symlink on `PATH`. An invalid selected path or
binding is an error, never permission to operate a different stack. If no stack is
found, ask for its checkout path. For a requested persistent default, run
`node <loaded-skill-directory>/scripts/traefik.js bind --stack /absolute/checkout`.
Both hosts share the binding described in [operations.md](references/operations.md).

Require successful compatibility detection before stack operations. An older CLI
must be updated separately; never work around a failed contract using raw Compose
mutations. Read the selected stack's `AGENTS.md`/`CLAUDE.md` when present. Use the
returned absolute `tk` path and returned `stack` as the command's working directory.
Quote paths and service arguments; do not eval JSON or build shell source from it.

## Inspect, act, verify

1. Run `tk list --json` to resolve **Compose service keys** and actual router URLs.
   Use `tk status --json` for container state, `tk inspect SERVICE --json` for build
   context/dependencies, and `tk logs SERVICE --tail 100` for finite logs. Use
   `--follow` only for requested streaming. A container name is not a service key.
2. For connectivity failures run `tk doctor --probe --json`. Distinguish Docker
   access, DNS, certificate trust, routing, application auth and optional local-memory
   readiness. Sandbox access failure means unavailable, not stopped. Do not treat a
   successful `curl --resolve` or insecure TLS request as normal hostname readiness.
3. Match the user's requested operation to the smallest explicit target. Preview
   `tk start|stop|restart|rebuild SERVICE --dry-run --json`, then apply the authorized
   command without `--dry-run`. Use `--all` only for intended whole-stack operations;
   `--with-deps` only when starting dependencies is intended. Use `rebuild` after an
   image/code change; `restart` alone does not install a rebuilt image.
4. Removal starts with `tk remove SERVICE --json`. Read the preview and retention
   notes, then use `--apply --json` within the user's authorized scope. Volumes and
   app source remain; container-only data is lost. Report the private backup path.
   Never broaden this into shared-stack shutdown, volume deletion or orphan cleanup.
5. Check the result and run `tk wait SERVICE --timeout 30 --json` when needed. For
   routed changes, verify the intended HTTPS endpoint using normal DNS and TLS.
   On timeout or partial failure, inspect current state before retrying. On
   `operation_in_progress`, let the owner finish; never delete the checkout lock.

Ask only for missing intent or required authorization; prior authorization persists.
Keep secrets out of output: do not print `.env`, full resolved Compose configuration,
Docker environments, bearer tokens or private keys. Redact log excerpts before sharing.
Host DNS and certificate repairs are separate operations: read the selected checkout's
scripts and document the concrete repair first. Never request a password in chat.

## Onboarding and memory

For a new application, inspect the onboarding instructions in the selected stack at
`scripts/.claude/skills/traefik-onboard/SKILL.md` and its `invariants.md` before adding
routes. Those stack-specific instructions are external dependencies, not bundled
copies. If missing, report onboarding as unavailable and continue independent
diagnostics. Verify app-side authentication for network-exposed data/API routes.
Do not expose local-memory's desktop stdio server through Traefik.

When current user/host policy enables centralized activity, use the installed
`local-memory` skill: check live readiness, recall relevant outcomes, and record a
concise source-backed result with artifact links and verified state. Synthetic notes
are not user evidence. If unavailable, disclose the missing activity entry; do not
invent success or create a fallback store. This public skill does not itself opt a
user into personal memory and never bundles vault content, credentials or transcripts.

## Report

**Never claim a result you did not observe.** State the selected stack, affected
service, preview/applied state, observed readiness and any unresolved failure. Keep
container health, endpoint checks and memory recording as separate verified facts.

<!-- press:runtime -->
In Claude Code, load `/press`; in Codex, load `$press`; then follow the shared PRESS terminal/UI contract from `brand/agent-ui.md`. Do not copy or override that contract here.
<!-- press:runtime -->

## Maintainer reference

The shared plugin owns instructions and a small locator/compatibility checker.
The external `tk` repository owns every stack operation. `skill-invariants.json`
records deterministic commands and model judgment; [operations.md](references/operations.md)
documents failures and CLI ownership. [baseline.md](references/baseline.md) explains
the real captured contract and its offline replay, including a known-bad trap.
