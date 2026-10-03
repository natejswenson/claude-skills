# Skill CI and release configuration

Edit `.github/skills-config.yml` to register a skill or change its CI recipe. The
file uses **strict JSON syntax**, which is also valid YAML 1.2. Comments, duplicate
keys, anchors, unquoted keys and trailing commas are rejected. This keeps the
Node runner and installed skillfactory dependency-free and sharing one contract.

`schemaVersion` is 1. `sharedPaths` lists changes that run every skill. `skills`
maps each skill slug to:

| Field | Meaning |
|---|---|
| `paths` | Own change paths plus cross-skill dependencies; combined with sharedPaths |
| `python` / `node` | Runtime versions as strings; empty node uses runner-provided Node |
| `npmCache` | Lockfile path for setup-node npm cache, or empty string |
| `timeoutMinutes` | Job limit; 360 preserves GitHub's original default |
| `concurrency` | `none`, `queue`, or `cancel-pr`; independent per-skill job groups |
| `checks` | Ordered `{run, cwd}` commands after common score/plugin lint |
| `release.versionSource` | `auto`, `package-json`, or `skill-md` |
| `release.npmPublish` | Explicit npm publish opt-in |
| `release.propagate` | Press-only post-release propagation |

Commands are executable repository code, reviewed like workflow `run` steps.
They use separate bash shells with `-e -o pipefail`; shell state does not persist
between entries. Paths are repository-relative and working directories may not
escape through traversal or symlinks. Never put credentials in configuration.

Run `node tools/skills-ci.mjs validate` to check the schema and exact agreement
with skill directories, release components, shipflow requiredChecks and the
repository settings contexts. Run `SKILL=resume node tools/skills-ci.mjs run` for
the same lint/commands used by that skill's CI (after installing its runtimes).

On PRs, `ci.yml` always creates every `ci / <skill>` matrix job. Only changed
skills run heavy checks; shared configuration/runner changes run all of them.
The matrix has fail-fast disabled. A bad preparation job fails closed and leaves
required checks missing; fix the preparation error rather than weakening checks.

Release tooling dispatches `release-dispatch.yml` on main with `skill=<slug>`.
For a manual dispatch, use `gh workflow run release-dispatch.yml --ref main
--raw-field skill=<slug>`. Only use this after the reviewed version/changelog PR
lands. The entrypoint validates the skill, runs real selected-skill CI regardless
of change filters, then calls `_release.yml` with that skill's release options.
CI has read-only permissions and receives no publish/propagation secrets.
The release job has contents write; a successful press release alone calls
press-propagate. Main pushes, PRs and non-main dispatches cannot release.

Shipflow's optional `release.componentLayout.workflowInputs` map expands `{name}`
and passes each entry as a separate `--raw-field` argument. Repositories without
inputs retain their existing dispatch behavior. Workflow filename and resolved
inputs participate in the release decision hash, so changed routing requires a
new review. Skillfactory detects this registry and adds config entries instead of
caller YAML; legacy repositories retain their original scaffolding.

The migration fixture `tools/tests/fixtures/pre-consolidation-workflows.json`
records the actual 26 old caller recipes, with source commit and content hashes.
Parity tests preserve commands, directories, filters, runtimes, caches, limits
and release options. Historical skill baselines remain unchanged. Before merging
the migration, verify the draft PR emits all original required check names and
that the actual GitHub run is green. Local lint and tests do not establish that.
