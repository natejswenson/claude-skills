# GitHub-flow cutover

The implementation changes ordinary development to reviewed feature PRs into main,
preserving explicit per-skill release dispatch and independent namespaced tags.
The draft PR stage prepares the code and this procedure. It does **not** authorize
merging PRs, changing live settings, deleting dev, or publishing a release.

## Observed before cutover

The read-only audit on **2026-09-12 at 20:38 UTC** observed:

| Item | Observed state |
|---|---|
| main | `d5e40e27bd016928471e82716b7587e90e8b30b0` |
| dev | `60ec51dd5d20c6d8280ad0ca7c730d44240bcf2c` |
| Unique dev work | One commit: issuecreator PR #359 |
| Open bottom PRs | #315 and #317 target dev; both must eventually target main |
| Upper stack | #318 targets `feature/issue-271-ghostwriter-x-codex-radar`; retain that relationship |
| Pending promotion reminders | 57 merged dev PRs retain `release-pending` |
| Main protection | PR required; 0 approvals; admin bypass retained; 19 required skill contexts |
| Missing required contexts | `ci / appletv` and `ci / issuecreator` relative to the committed 21-skill policy |
| Repo settings | main default; auto-merge, squash, merge commits, rebase, and branch cleanup enabled |
| Rulesets / active workflow runs | None observed |

These are historical observations, not permission to use the same SHAs later.
The compact real-run record is
[`github-flow-cutover.json`](../skills/shipflow/skills/shipflow/evals/baseline/github-flow-cutover.json).
The full audit records settings/protections, workflow state, each PR's original
head/base, tags, each component's main version, changed tree since its current tag,
and each old reminder's component mapping. No release was dispatched. Preflight
still provides the commit-level release proposal; a changed component tree alone
does not select a new version.

The live main settings still use the old policy. This implementation prepares
21 required checks, squash-only main merges, and linear history; it preserves the
existing PR approval and admin-bypass policy. No setting has been applied here.

## Cutover order after authorization

Before the first merge, run the reviewed helper's `audit` command from its feature
checkout with `--output <durable-recovery-folder>/premerge.json`. Preserve that
original policy/workflow/settings snapshot alongside the later `before.json` and
journal. The premerge snapshot is recovery evidence; execution always uses the
fresh post-merge audit at step 3.

1. **Preserve all branch work through reviewed PRs before retiring dev.** Refresh
   main/dev and inspect both sides. The reviewed implementation lanes start on dev
   and are stacked; land them in their reviewed order, then bring their final
   tree and all unique dev work into main through a reviewed transition PR. Use
   the existing merge-commit capability for this last conservation merge so the
   captured dev commits remain ancestors of main. A squash or cherry-pick can
   preserve file content while leaving unique commits; the retirement guard
   deliberately refuses that ambiguous ancestry. Do not reset or force-push main.
   Resolve conflicts against current main; preserve its 115 previously observed
   main-only commits. Recheck versions and tags without bumping them for cutover.

2. **Wait for every required context on the transition PR and review its final
   diff.** Keep it draft until the authorized ready/merge decision. Keep branch
   deletion protection on dev while this last merge lands. The source-controlled
   main workflow must replace the promotion workflow in the merged main tree
   before executing the helper. Pause overlapping merges during the cutover.

3. **Check out the exact merged main commit and capture fresh evidence.** Store
   full audit and journal files outside the checkout in a durable recovery folder.
   `audit` makes GET requests only; it writes a new file and refuses to overwrite
   existing evidence. Missing/incomplete API responses or moving branch SHAs
   fail the audit. No successful audit is emitted after a partial inventory.

   ```sh
   git fetch origin main dev --tags
   git switch main
   git pull --ff-only origin main
   mkdir -p /private/tmp/claude-skills-cutover
   python3 tools/github_flow_cutover.py audit \
     --output /private/tmp/claude-skills-cutover/before.json
   ```

   Copy the recovery folder to durable storage before deleting dev. The helper
   requires an audit less than 24 hours old, exact captured branch SHAs, a clean
   tracked checkout at the audited main commit, and matching main policy bytes.
   If main/dev change, retain the old evidence and start a fresh audit/journal.
   A changed snapshot is never patched to make execution pass.

4. **Apply and verify the main settings.** This is the first live settings step.
   It adds both missing required contexts and applies the committed merge policy.
   The helper requires zero dev-only commits before any mutation.

   ```sh
   python3 tools/github_flow_cutover.py execute --step settings \
     --audit /private/tmp/claude-skills-cutover/before.json \
     --state /private/tmp/claude-skills-cutover/journal.json
   ```

5. **Retarget ordinary dev PRs and the bottom of each stack.** Confirm the fresh
   audit's mappings with their owners before applying the already authorized
   cutover. Upper feature-base layers retain their relationships. The helper
   refuses a dev-based PR that appeared or changed after capture; reverse
   promotion PRs require manual reviewed disposition.

   ```sh
   python3 tools/github_flow_cutover.py execute --step retarget \
     --audit /private/tmp/claude-skills-cutover/before.json \
     --state /private/tmp/claude-skills-cutover/journal.json
   gh pr checks 315 --required --watch
   gh pr checks 317 --required --watch
   ```

   Substitute the actual mapped PR numbers from the fresh audit. Changing a base
   fires PR CI; verify every required context reports at the resulting head/base.
   Rerun missing checks through the reviewed CI workflow if necessary. A green
   subset is insufficient. The helper never requests a merge, including when
   retargeted PRs have red CI. Main's protection does not protect feature bases;
   inspect every upper layer's CI separately.

6. **Resolve obsolete promotion reminders while retaining release decisions.**
   Review `pendingReminders[].componentStatus` in the fresh audit: every changed
   component maps to its current main version/tag/tree or is explicitly absent
   from main. A present undeclared component blocks the audit. Preserve this
   inventory and the journal. This step removes old merged dev-PR labels only;
   new GitHub-flow PR reminders remain. It does not dispatch any release.

   ```sh
   python3 tools/github_flow_cutover.py execute --step reminders \
     --audit /private/tmp/claude-skills-cutover/before.json \
     --state /private/tmp/claude-skills-cutover/journal.json
   ```

   An untagged bump or changed tree remains pending after label removal. The
   release engine independently inventories all configured components without
   labels, so this cleanup cannot declare a component released.

7. **Retire dev last.** The helper takes another live inventory, requires no
   unique dev work, no open dev PR base, no old dev reminder, and no active
   workflow run. It disables the old promotion workflow if GitHub retains its
   workflow record, verifies that result, removes dev protection, and deletes
   dev only while its captured SHA still matches. Every attempted change is
   written to the journal before the API call; read-back marks completion.

   ```sh
   python3 tools/github_flow_cutover.py execute --step retire \
     --audit /private/tmp/claude-skills-cutover/before.json \
     --state /private/tmp/claude-skills-cutover/journal.json
   ```

   Retry the same command after a transient settings/protection/deletion error.
   A lost deletion response is reconciled by reading dev back, with the original
   recovery snapshot retained. If either branch moved, capture a new audit and
   keep the previous journal. GitHub does not offer an atomic transaction across
   PR retargets, protection, and branch deletion; pause concurrent branch changes
   and inspect any refusal instead of forcing it through.

8. **Record final acceptance.** Preserve `journal.finalAudit`: main's settings,
   complete required checks, absent dev, disabled/absent promotion automation,
   and pending components. Observe all required checks on a real feature-to-main
   PR. Run this checkout's read-only release preflight after fetching main/tags:

   ```sh
   git fetch origin main --tags --prune
   node skills/release/skills/release/scripts/release.js preflight --repo .
   python3 tools/sync_codex.py --check
   python3 tools/check_compatibility.py
   ```

   Record preflight succeeding without dev and the remaining release decisions.
   Controlled fixtures prove dispatch/tag safeguards; a real release requires a
   separate request. No deliberately failing live merge attempt is required or
   claimed. Settings read-back plus controlled red-CI tests are the available
   evidence for merge prevention until a suitable live observation exists.

## Recovery

On failure, keep dev and the evidence. If deletion already happened, recreate
dev at `journal.recovery.branches.dev` using the Git ref create endpoint; never
point it at today's main as a substitute for the captured commit:

```sh
gh api -X POST repos/natejswenson/claude-skills/git/refs \
  -f ref=refs/heads/dev -f sha=<captured-dev-sha>
```

Do not overwrite an already existing dev ref: compare it to the captured SHA
and investigate discrepancies. Restore captured dev protection by converting
the recorded GET response to a PUT body (strip response URLs; unwrap each
`enabled` value; retain required contexts/app IDs and review policy). Restore
main/repository settings from the same snapshot only after reviewing the exact
diff and obtaining rollback authority. Retarget affected bottom PRs to their
recorded bases only after dev is restored; leave upper stack relationships intact.

Restore code/config through a reviewed revert PR on main, including the old
rendered workflow and its matching hash. The snapshot retains the pre-operation
policy; the committed historical shipflow golden retains the pre-migration
promotion config/workflow. Re-enable old automation only after both code and
protection are restored and verified. Never delete a published tag, reset main,
or invent a replacement version as recovery. Existing npm releases remain intact.
