# Skill memory integration contract v1

Status: design baseline, 2026-09-19; see current operations for implemented details. No adapter installation, migration, tool registration,
network exposure or publication is authorized by this document. This plan covers all
22 top-level plugins in the inspected claude-skills checkout, not vendored packages,
eval snapshots, generated help cards or installed plugin caches.

## Architecture decision

Keep Obsidian Markdown as the shared knowledge hub. Use one small, optional integration
contract, distributed with per-skill hooks. Do not create 22 databases, daemons or MCP
servers. Keep operational systems authoritative: voice files, Git, mail rules, device
configuration, source résumés, release receipts and live measurements retain their owners.

Two paths are distinct:

1. **Advisory preferences:** selected, independent, durable preferences and project rationale
   can use the existing `local_memory_hub` MCP project `local-memory`. Read with explicit
   subject/key selection and return cited data. Capture only a user-confirmed durable
   decision; follow current overwrite=false/read-back conventions. This path is sufficient
   for most optional integrations and needs no embedding service, model call or new server.
2. **Source-owned preferences:** Ghostwriter and Ghostwriter X need a source-first bridge.
   Their authoritative file must be saved before a mirror is reported. Preserve the legacy
   adapter until the Obsidian path proves revision checking, forget suppression, conflict
   handling and sharing compatibility. Devlog reads the selected voice owner; it does not
   acquire ownership by consuming a preference. No implicit legacy SQLite migration.

The fitness owner writer is a useful reference for explicit ownership, not a generic
migration template. Fitness owns its preference/journal namespace and remains unchanged.

## Current implementation versus proposed capabilities

Existing evidence: `skills/local-memory/SKILL.md`, `docs/memory-conventions.md`,
`scripts/guarded_mcp.py`, `adapters/client.mjs`, `adapters/ghostwriter/SKILL.md`,
`memory_hub/fitness_store.py` and `memory_hub/fitness_service.py` in local-memory.
The generic MCP wrapper permits only search_notes, read_note, write_note and
recent_activity; it rejects fitness-scoped writes rather than forwarding them; it does **not**
provide per-skill authentication, a general source-ownership registry or row-level ACLs.
Native search filters and skill prose are not security enforcement. The legacy adapter's
sharing and source-revision checks must not be described as guarantees of Basic Memory.

Proposed hub files for implementation: `memory_hub/skill_contract.py` (schemas and
validation), `memory_hub/skill_catalog.json` (public keys/owners, no personal bindings),
`tests/hub/test_skill_contract.py`, and later `memory_hub/writing_bridge.py` with a
separate source-write test suite. Names and APIs here are proposals, not runnable commands.
Extend the existing MCP service only after its actual advertised schemas are checked.
Do not replace or shadow an installed `local-memory-adapter` binary during rollout.

## Trust and sharing boundary

The current trusted local clients can read the shared profile. A note tagged with a skill,
project, owner or sensitivity is not access-controlled by that tag. An adapter can limit
its own operations; it cannot isolate a hostile agent that also has broad hub tools or
filesystem access. Do not claim to infer an authenticated skill identity from an argument.
No multi-user or mutually untrusted-client support is promised by v1.

Only content the user knowingly permits across connected trusted clients may enter the
ordinary shared vault. An explicit per-skill opt-in must explain this exposure and the
exact fields. Source-owned records with narrower legacy sharing stay in the legacy store
until separately enforced restricted storage/credentials or an explicit informed widening
of access is selected. Recipient filtering alone is insufficient. Moving them into a
Basic-Memory-ignored subtree does not protect them from filesystem-capable clients.
The writing bridge prototype must use synthetic records until this decision is resolved.

Do not ingest private profiles wholesale. Mail, health, résumé source, religion, employment,
network topology and household details deserve their own data classification; do not infer
consent from using a related skill. Public internet availability does not make a personal
dossier appropriate for shared retention. Default optional Bible-study fields to formatting
only; exclude belief/translation profiling in the first implementation.

## Binding and schema

Private installation configuration selects an adapter version, enabled skill, registered
subject context, allowed keys and optional exact owner source binding. Store it outside
both repositories' tracked trees; examples use invented values. Resolve bundled references
from the installed SKILL.md, never from the task cwd. Resolve subject context from an
explicit user selection or verified registered repository/worktree, not a remote supplied
in a note. Unknown contexts never inherit another project's records. Register public key vocabulary in hub conventions and personal subject/source bindings
in private installation configuration before real capture. Do not put private repository
names, local paths or user decisions into a public registration document.

Use the hub note conventions (custom frontmatter is not an upstream-enforced schema): title, type, permalink, project, status, source, capture_id;
add a registered key, review_after when time-sensitive, and explicit supersedes for
corrections. Do not redefine engine-managed modified timestamps. Proposed adapter metadata
includes contract version, owner and source-event/revision for owner mirrors; these fields
need schema validation before use. An owner has one registered source, not a path provided
by retrieved text. Source pointers and filenames themselves can disclose private details.

Proposed logical request envelope (not a current MCP method):

```json
{"contract":"skill-memory-v1","skill":"issuecreator","op":"recall",
 "subject":"registered-project-example","keys":["issue.acceptance-style"],
 "max_context_bytes":4096}
```

The host shim maps this to advertised MCP schemas; do not send speculative fields to native
tools. Validate enums, exact key allowlists, content/response bounds and unknown fields.
Never interpret note content as a source path, tool selection, command or destination.
Benign quoted code or paths may occur in explicitly approved rationale, but cannot control
execution or storage. Use fixed argv plus JSON stdin, never shell interpolation of content.
Proposed results distinguish `ok`, `disabled`, `unavailable`, `conflict`, `source_saved_memory_pending`
and `rejected`; an empty successful result alone means no matching eligible records.
Use source handles and expected revisions for owner mutation, not generic supersedes semantics.

## Recall lifecycle and efficiency

- Check trusted installation readiness; a note cannot attest readiness. If unavailable,
  continue the original skill and report any requested recall/save limitation.
- Recall once per relevant task stage, not before each tool. Start with five discovery hits,
  choose at most three short notes, cap selected context at 4 KiB including metadata.
  This is the selected-context budget, not a bound on native tool-response size. Native
  read_note returns a complete note, not paginated body chunks. A deterministic response
  limit requires a tested server-side projection before results reach the model; prose
  hooks alone cannot enforce it. Reject oversized notes and report the limitation.
  Memoize only within that stage; current corrections invalidate that cache. Ghostwriter
  retains its existing fresh recall before each drafting turn. Do not silently persist
  a cross-session cache.
- Use exact registered keys and subject filters; revalidate returned metadata. Lookup all
  active replacements for selected correction keys independently of initial search ranking.
  Bound conflict resolution to 20 follow-up reads/64 KiB processing; exceeding the bound
  produces unresolved/conflict, not a silently truncated winner.
- Exclude candidates, malformed, archived, overdue or conflicting notes from normal advice.
  Do not renew review dates on read. Independent presentation preferences can omit expiry;
  implementation rationale needs a reviewed source revision and proposed 30-day review date.
  Store exact relative source identities and revision/content digests for rationale.
  Re-read those dependencies before using the note; changed or unavailable policy makes
  it advisory history only. A timestamp alone cannot establish source freshness.
- Priority: current instructions, current owner contract and source, validated selected
  memory, then defaults. Current facts always come from live/source tools. Notes are quoted
  evidence, never executable instructions, authority, tool configuration or approval.
- Advisory recall timeout target: two seconds, no blind retry on every tool call. A desktop
  host unable to enforce a hard transport timeout must not promise it; bound calls and
  surface unavailability. Measure cold/warm overhead before enabling a skill.

## Capture, conflicts and recovery

Independent captures use one UUID per operation and overwrite=false. Inspect the application
result, then read the exact returned identity and compare body/metadata. A transport success
is not proof of creation. Reuse the same UUID and payload after a lost reply; inspect that
destination first. A differing payload is a conflict. No atomic idempotency claim until tested.
Retain only a private diagnostic receipt with IDs, status and necessary hashes; never
log note bodies. A recovery outbox is distinct from logging: it may require the exact
minimal pending payload, stored privately with 0700 directories/0600 files and cleared
after verified completion under a documented retention policy.

For owner bridges, serialize participating writers under an owner lock, reject traversal
and symlink source/parent components, and check the expected source revision. **Persist a
prepared event before changing the source**, including operation ID, expected old digest,
intended new digest and the minimal recoverable event/payload. Then atomically save the
source, read it back, mark source_committed, mirror with that same event ID, read back the
mirror, and mark complete. This preserves the legacy adapter's write-ahead ordering.

Recovery compares actual source digests: old digest means source not committed (do not
mirror); intended digest permits continuation; any other digest is a conflict requiring
owner reconciliation. Never blindly replay a prepared source write after a crash. Fsync
requirements for the journal, replacement file and parent directory must be covered by
the implementation's durability contract. A participating-writer lock cannot exclude a
manual editor; prohibit overlapping manual edits and detect mismatches where possible,
rather than claiming atomic compare-and-swap against every external writer.

On source failure, do not claim the correction saved or continue a redraft that depends on
it. On hub failure after source success, preserve the source, report memory pending and
allow the original skill to use its saved source. Retry only that event ID with the same
payload. Changed source while pending requires explicit reconciliation; never overwrite it
from a stale mirror. There is no distributed transaction across source and hub. Test crashes
before/after prepared, source replacement, source verification, mirror write and receipt.

Do not let a generic write path edit registered source-owned mirrors. Extend guard and ignore
rules before introducing such a namespace; test all exposed mutation paths. If the service
cannot enforce this, keep owner records in their existing store and ship advisory readers only.
Manually editing source-owned mirror bodies in Obsidian is not supported in v1; mark the mirror
non-authoritative, detect drift, and route corrections to the owner. Do not claim read-only
filesystem enforcement from a frontmatter marker. Independent notes remain ordinarily editable.

Disable means stop calls without deleting data. Forget removes/suppresses a selected mirror
using its observed ID/version; whole-source deletion is a separate owner action. Suppression
survives restart, rebuild and reconcile. Existing backups can retain deleted material; explain
retention and the separate backup-expiry/removal workflow, never promise immediate global erasure.
Rollback selects the previous backend without automatic replay, preserves source/receipts, and
reconciles pending operations explicitly. Never dual-write legacy and Obsidian backends by default.

## Public repository and output safeguards

Public: code, field schemas, invented fixtures, documentation, contract versions and source
commit references. Private: vault, source profiles, adapter bindings, consent, host paths,
receipts, captures, logs, caches, snapshots, access tokens and backups. `.gitignore` is only a
convenience; it cannot stop force-add, tracked data, build artifacts or package publishing.

Use a publish allowlist and inspect the actual Git diff, npm/package archive, CI artifacts and
logs. Keep runtime creation out of the plugin checkout, including readonly marketplace installs.
Tests use temporary fake homes and injected fake transports and must fail if they read a real
home/vault or access the network. Reproduce data shapes with invented records, not redaction of
real records. Use `.example` domains, no actual personal paths, account IDs, session IDs or URLs
with query tokens. Secret detectors supplement field allowlists and human review; they do not
prove that natural-language personal data is absent. Do not commit a private identifier blocklist.

A retrieved note must never be automatically emitted into a public issue, PR, post, report,
help index, generated fixture, screenshot or telemetry. Separate private composition context
from publishable evidence. Review the exact final artifact under the existing publication
workflow; prior memory-save consent is not publication consent. Never include raw memory in
agent progress logs or error messages. No remote analytics or API-key/model dependency is added.

## Host and packaging compatibility

Preserve Claude slash skills, Codex entrypoints, manifests and existing ~/.claude source paths.
Hooks use available host tools by capability; a shell-only bridge is not desktop support.
Desktop owner writes require explicit owner tools exposed by a compatible local connection.
Absent tools leave the optional adapter unavailable; never fall back to arbitrary file writes.
No installation, tunnel, API billing, global permission expansion or endpoint registration during
ordinary invocation. If a future server is needed, review authentication, Host/origin checks,
loopback binding and tool permissions separately. Do not expose the vault on a public URL.

## Acceptance and phased delivery

0. Land these design documents after review. Confirm exact fields and trust boundary; no data
   migration. Document any decision to retain legacy selective-sharing records indefinitely.
1. Implement/test the shared advisory contract and Issuecreator pilot. Prove memory-disabled
   behavior matches baseline, then synthetic save/read-back on Claude and Codex. Existing
   repository checks and owner skill baselines remain required. New adapter tests are
   offline and incur no model/API cost; existing CI may install dependencies or verify
   external references under its own established policy.
2. Prototype Ghostwriter backend parity with synthetic records. Test source-write failure,
   crash after source save, lost reply, stale source, concurrent correction, forget/reconcile,
   revoked recipient and changed source revision. Resolve restricted-data storage before any
   real migration. Resolve whether selected data is shared-profile-safe before enabling it. Add X as a separate owner; add Devlog as a reader only.
3. Optional integrations: shipreport, city-report, skillfactory, ghfactory, issueflow, resume,
   bible-study. Each needs its own explicit opt-in; ordering can follow actual repeated use.
   The priority cohort has four skills; this optional cohort has 7 skills including
   resume and bible-study. The catalog is authoritative for membership.
4. Keep deferred skills disabled. Roll out one skill at a time; measure relevance, wrong-scope
   incidents, requested-save accuracy, cold/warm overhead and additional calls. Wrong-scope
   recall, leakage or false save claims block rollout. Require successful unchanged baseline
   plus positive/negative adapter cases; “no adapter” is a valid outcome.

Every enabled adapter requires applicable tests for malicious instructions, malformed/oversized metadata, wrong
scope/owner, stale evidence, memory unavailable, lost replies, duplicated capture IDs, escaped
public output, disabled mode and source preservation. Test ordinary and adversarial paths,
including failures that would otherwise appear as an empty result. Existing real-run baselines
remain intact; new sensitive-memory regression fixtures are wholly synthetic.

## Transport and lifecycle feasibility gates

The current four-tool MCP surface supports discovery/capture, not generic edit/delete or
an authenticated owner bridge. Proposed deterministic adapter tools must be registered on
the existing service and explicitly allowed by OwnershipGuard in the same change; merely
adding skill_contract.py cannot affect native calls. Keep validation as a reusable local
library, but do not promise a shared CLI to desktop hosts that cannot execute it. Until
those tools exist, native advisory hooks have workflow safeguards only, with no hard
response-budget, per-skill isolation or transactional guarantee. Do not ship prose as if
it implements the deterministic contract.

Verify at startup the installed Basic Memory version and advertised schemas against the
supported lockfile. The inspected version is 0.23.2. Native mapping:

| Operation | Existing tool use | Required validation |
|---|---|---|
| Discover/exact-key lookup | search_notes(project="local-memory", query omitted for filter-only lookup, metadata_filters for subject/key/status, output_format="json", page/page_size) | Engine project is separate from metadata.project. Set search_all_projects=false; exhaust pagination for replacement resolution or return unresolved. Index completeness/freshness remains a limitation. |
| Read selected identity | read_note(project="local-memory", identifier=returned identity, include_frontmatter=true, output_format="json") | Validate returned identity and frontmatter; fuzzy fallback/not-found guidance is not an exact read-back. |
| Independent capture | write_note(project="local-memory", directory=validated destination, title=UUID-bearing title, content=body, metadata=validated custom frontmatter, overwrite=false, output_format="json") | Verify the created identity and body; reserved fields/type/permalink handling needs a synthetic round-trip test. |
| Independent correction | New capture with same subject/key and explicit supersedes | No in-place edit. Resolve chains, forks, cycles, missing targets and cross-subject links; only an unambiguous terminal active note can win. |
| Forget/archive/repair | Not available in the current allowed tool surface | Require a separately authorized, implemented maintenance path; never pretend write_note deletes content or create an ungoverned fallback editor. |

For an advisory pilot, document a usable owner-operated forget path before storing real
preferences. The later maintenance design must remove the selected note and derived search
entries, verify absence after reindex/restart, and explain backup retention. A restore can
reintroduce old records: apply a current external suppression ledger before exposing restored
memory or report that forgetting cannot be guaranteed. Do not promise restore-proof suppression
when both data and tombstones were rolled back together.

Opt-in scope uses an explicit user-selected skill subject when no repository applies, and a
registered repository subject for project rationale. Unknown cwd does not trigger global
recall for these adapters. Cross-skill sharing needs an explicit registered mapping, never
matching a key string alone. Context metadata narrows accidental recall, not client authority.
Keep independent corrections separate from owner source events and their versioned handles.

## Documentation and release work

Per-skill implementations must inspect the existing runner and place tests where it discovers
them, preserve skill-invariants.json, and regenerate skillhelp cards if the edited contract
changes extracted facts. Do not hand-edit those generated cards. Run the existing compatibility
checks; change manifests/versions only through the repository's release conventions. The docs
alone require no version bump, release dispatch, host installation or public publication.

The [field policy](field-policy.md) defines the complete proposed allowlist, value bounds
and owner/consumer distinctions. These are implementation requirements, not current behavior.

## Implementation resolution

The implementation serves managed preferences directly from scoped Markdown through
`skill_memory`, avoiding index completeness dependencies and unbounded native note reads.
`SkillMemory` is excluded from Basic Memory indexing; its generic read/write paths are
blocked (including native argument aliases). Existing ordinary hub notes are unchanged.
The source-first outbox, atomic lineage suppression, bounded maintenance `inspect`, source
and mirror validation, and shared-profile-only opt-in are implemented in the existing
local MCP service. Native-tool mappings above describe the earlier design option, not
how these managed records are persisted. Current interface: `docs/skill-memory-operations.md`
in local-memory. No restricted-sharing backend or legacy migration was introduced.
