# Optional skill memory operations

The `skill_memory` tool is registered on the existing `local_memory_hub` local MCP
server. All 22 skills have policies; eleven support optional integration and eleven
are explicitly deferred. Installation leaves every skill binding disabled. No note,
plugin installation or remembered permission can enable a binding.

## Private setup

Use `scripts/skill_memory_admin.py status` to inspect whether bindings exist without
printing their values. For deliberate setup, pass a complete private configuration
on stdin to `scripts/skill_memory_admin.py configure`; it backs up the prior config.
Never commit that configuration. Example structure, with invented subjects:

```json
{"version":1,"bindings":{"issuecreator":{"sample-project":{"enabled":true,"shared_profile":true,"repo_path":"/private/example/project"}}}}
```

Replace the example path with the actual registered target repository when configuring
locally. `shared_profile:true` acknowledges that trusted connected clients/filesystem
users can read the shared vault. It is a privacy decision, not an ACL. Keep narrowly
shared legacy writing records in the legacy backend; do not backfill them here.

Independent presentation preferences do not require repo_path. Rationale keys require
it, dependency relative paths with exact SHA-256 revisions, and review_after no more
than 30 days ahead. Subject IDs must be explicitly selected or privately registered;
no cwd, remote name or note implies a registration.

Ghostwriter and X owner bindings additionally require source_path pointing to the
actual voice-notes.md outside the vault/control tree. Backend selection is a trusted
host choice: run either the original/legacy writer or this bridge for an opted-in key,
never both. `status` returns the current source revision; capture supplies it as
expected_source_revision. Existing source files retain authority. No profile import,
legacy database migration or source directory scan occurs.

Devlog sharing needs its source_path to match the actual selected voice source. The
reader binding contains `reads:{"writing.hashtags":{"skill":"ghostwriter","subject":"writer-subject"}}`;
the owner binding explicitly includes `readers:["devlog"]`. Recall supplies the selected
source revision. For shared project rationale, an explicit reads mapping plus owner
readers entry is also required, and both bindings must point to the same repository.
A configured foreign key is read-only for that consumer. Nothing shares by key name alone.

## Storage and guarantees

- Canonical notes: `vault/SkillMemory/<skill>/<subject-sha256>/<UUID>.md`.
  Frontmatter is JSON-compatible YAML; the Markdown body is the editable preference.
  Non-string values use JSON bodies. Normal independent body edits are validated on read.
- Private configuration, operation receipts and suppression ledger:
  `.runtime/skill-memory/`. Directory/file creation uses 0700/0600 permissions.
  Pending events can contain the minimal preference payload; completed receipts omit it.
- This managed namespace is excluded from Basic Memory indexing. Generic note calls cannot
  read/write its explicit path or write its contract metadata. The skill tool validates
  scope before reading bodies, so an unrelated malformed note cannot poison another scope.
  This is a tool-routing boundary, not isolation from a trusted filesystem-capable client.
- Recall reads Markdown directly, validates source/dependency revisions and correction chains,
  and bounds its complete output. Stale, conflicting, tampered, malformed or over-budget
  records are withheld. Maximum 2,000 notes per skill/subject; capacity errors are explicit.
- Writes use an exclusive local process lock. Busy operations fail visibly for an intentional
  retry. Do not overlap manual source or vault edits with writes; external editors do not
  participate in the lock. Never infer an atomic filesystem snapshot or transaction across
  unrelated owner files and the vault.

## Capture, retry and forget

Use the per-skill reference for the exact allowed key/value fields. A new capture generates
one UUID. Reuse the entire request after an uncertain result, including source revision,
provenance and selected supersedes ID. Do not refresh status and rebuild that same operation
with a different payload. A success is status=saved, verified=true and a read-back record.
Source failure prevents dependent redrafting; source_saved_memory_pending permits use of
the verified saved source, but is not a claim that hub mirroring succeeded.

A prepared event precedes any source write. Retry compares intended source and current
lineage/dependencies before mirror completion. If recovery reports conflict, inspect the
owner source and selected notes; reconcile by an explicit new operation only after deciding
which source value is current. It never overwrites the owner source during retry.

A correction must name the selected current record in supersedes. Multiple roots, broken
chains or forks are conflicts, not latest-timestamp wins. Owner mirrors are checked against
their committed digest and source revision; edit the source through its owner, not the mirror.

When recall withholds stale data, `inspect` with owned keys returns only unambiguous
current handles, without preference values. `state=current` identifies lineage separately
from `evidence_state=valid|stale`. Conflicting chains are listed in conflict_keys and need
explicit owner repair. Request fewer keys if the bounded inspection response is too large.

Forget takes the current id and expected_revision. One atomic ledger update suppresses the
whole correction lineage before removal. Retry resumes cleanup after a crash, preventing an
older value from reappearing. Source-owned forget retains the voice source; remove that
separately through the owner's existing workflow when the user asks to forget it entirely.

Backups may contain old bodies. A vault-only restore must remain quarantined and be checked
against the current `.runtime/skill-memory/forgotten.json` ledger before exposing records.
Retain that current ledger outside the restored snapshot. Rolling back both data and ledger
cannot guarantee forgetting; do not activate such a restore without reconciliation. Existing
vault backup commands remain quarantined; they are not a new coordinated backup of this
control directory. Back up vault and control while writers are idle, keep both private, and
never delete control as routine cleanup. Disabling a binding deletes neither store.

## Verification and distribution

Run `python3 scripts/check_skill_integrations.py --skills-repo /path/to/claude-skills`
to validate inventory, policies, packaging and every invented field case against the real
validator. `--snapshot` deliberately refreshes the synthetic CI corpus after review.
Run the hub suite with its documented FITNESS_SOURCE_REPO fixture. Both repositories must
ship contract v1 together; an older host lacking the tool continues its original workflow.
New/restarted local chats load the refreshed tool list. Hosted web is not configured by this
change, and no OpenAI API key, tunnel, third-party telemetry or paid model call is introduced.
