# Operations and compatibility

`scripts/traefik.js` is a locator and contract checker, not a second Traefik CLI.
It never forwards stack mutations. Run it with Node from any working directory
using the path relative to the loaded skill. It needs no npm dependencies.

| Helper command | Behavior |
|---|---|
| `detect [--stack PATH] [--config FILE]` | Select a stack and call its `tk capabilities --json`; JSON result includes canonical `stack`, `tk`, `source` and compatibility. |
| `bind --stack PATH [--config FILE]` | Detect first, then atomically write a mode-0600 path binding. An incompatible CLI leaves the previous binding intact. |
| `check --input FILE [--out DIR]` | Offline validation of a captured contract; optional `compatibility.json` output for baseline replay. |

All commands emit JSON except `--help` and `--version`. Exit 0 means success,
1 means unavailable/incompatible/IO failure, and 2 means incorrect arguments.
Detection is bounded to 15 seconds and 256 KiB of captured CLI output; failure
messages do not echo potentially private CLI stdout/stderr. `TK_TEST_MODE` is
removed from the probe environment. The helper does not read or execute `.tkrc`.

Both hosts use `${XDG_CONFIG_HOME:-~/.config}/traefik-skill/settings.json`:

```json
{"schema_version": 1, "stack": "/absolute/path/to/traefik"}
```

The selected root must contain a Compose file and its own executable `scripts/tk`.
Order: explicit `--stack`, nonempty `TRAEFIK_DIR`, verified current-directory ancestor,
saved binding, then a `tk` executable resolving through `PATH` to a stack's `scripts/tk`.
Explicit input and stale bindings fail closed. Work outside a stack uses the binding;
work inside a different verified stack uses that checkout unless explicitly overridden.
The CLI is a trusted local executable: compatibility is not a security sandbox or
an authenticity check. Only select a checkout the user intends to execute.

Protocol 1 requires schema 1, `command: capabilities`, `ok: true`, and these features:
`inspection-json-v1`, `lifecycle-json-v1`, `lifecycle-explicit-targets`,
`lifecycle-dry-run`, `bounded-readiness`, `removal-preview-v1`,
`checkout-mutation-lock`, `tls-probes`, `local-memory-readiness`.
Required commands are `list`, `status`, `doctor`, `inspect`, `logs`, `start`, `stop`,
`restart`, `rebuild`, `wait`, and `remove`. Unknown extra capabilities are permitted;
unknown protocol versions are rejected until this skill explicitly supports them.

After detection, execute the returned `tk` directly with working directory `stack`.

| Request | External CLI |
|---|---|
| Inventory / status | `tk list --json` / `tk status --json` |
| Build paths / dependencies | `tk inspect SERVICE --json` |
| DNS / TLS / application readiness | `tk doctor --probe --json` |
| Finite logs | `tk logs SERVICE --tail 100` |
| Preview image rebuild | `tk rebuild SERVICE --dry-run --json` |
| Apply authorized rebuild | `tk rebuild SERVICE --json` |
| Scoped lifecycle | `tk start\|stop\|restart SERVICE --json` |
| Bounded readiness | `tk wait SERVICE --timeout 30 --json` |
| Removal preview / apply | `tk remove SERVICE --json` / `tk remove SERVICE --apply --json` |

Use service keys from inventory; infer neither service names nor URLs. Lifecycle
commands require a target or explicit `--all`. Start/rebuild leave dependencies
alone unless `--with-deps` is intended. Lock contention, timeout and partial failure
require a fresh status inspection before retry. Never bypass a lock by deleting it.
Removal preserves volumes, backs up the source privately and blocks dependents;
container-only data is lost. A preview is not an applied result.

Missing Docker access is an unavailable observation. Respect host sandbox approvals.
Use normal DNS and certificate verification for final endpoint checks. Do not print
resolved Compose environments, credentials, private keys or unredacted sensitive logs.
The CLI owns repairs and onboarding scripts; inspect their source at the selected
stack before a requested repair. Onboarding instructions remain at
`scripts/.claude/skills/traefik-onboard/` in that external checkout.
