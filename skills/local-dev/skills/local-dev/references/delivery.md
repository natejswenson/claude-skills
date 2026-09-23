# One final publication phase

Local development ends with tested, reviewed commits. GitHub is an output, not
an intermediate review or state store. Use ordinary `git` and `gh` from the
worktree. Resolve the push remote/repository explicitly from user intent and
local configuration; never print credential-bearing URLs. Never push the base.
A fork can have a different push repository from the PR's base repository.

1. Verify the named feature branch, clean task files, intended commits and base.
   If the base has not been refreshed, do one fetch now when online and inspect
   the resulting base diff. Integrate base changes only when needed; preserve
   local work, resolve conflicts and rerun affected checks before proceeding.
   Use the repository's merge/rebase policy, never a force-push to resolve drift.
2. Write the final PR title/body to a local file in a host-approved work area.
   Lead with the problem and resulting behavior, then local validation and any
   limitations. Reference the issue if there is one; direct feature input needs
   no issue creation. Link the plan path. Do not claim remote CI passed.
3. A successful create in this session needs no routine read-back. On a later
   resume, verify a saved URL once with `gh pr view URL --repo OWNER/REPO --json
   url,state,headRefName,headRepositoryOwner,baseRefName,isDraft`. A closed or
   merged PR is historical delivery; do not push more work to it or represent it
   as an open draft. Reconcile changed intent before publishing additional work.
   Without a saved URL, make one open-PR lookup before creation: `gh pr list
   --repo OWNER/REPO --head BRANCH --state open --limit 100 --json
   url,headRefName,headRepositoryOwner,baseRefName,isDraft`.
   Query by head, then inspect the returned base so a changed-base PR remains
   visible. Match the head owner as well as branch/base; a fork's same-named
   branch is not this PR. Multiple matches, a full 100-result page or a mismatched
   existing PR need reconciliation before a create.
   A failed lookup is unknown, not absence: retain local work and do not create.
4. Push the feature branch with ordinary `git push -u REMOTE BRANCH`, then run
   `gh pr create --draft --repo OWNER/REPO --base BASE --head HEAD --title TITLE
   --body-file PATH`. Pass values as properly quoted arguments; never embed issue
   text or Markdown inside a shell command. `HEAD` may be `OWNER:BRANCH` for a fork.
   If a matching PR already exists, push needed commits and report its URL;
   don't create another or change its readiness. Explain an existing ready PR
   rather than representing it as draft.
5. The successful create response supplies the PR URL; record and report it.
   No routine read-back, polling, CI wait, issue update or review comment follows
   a successful response. Opening the draft completes the normal workflow.

## Recovery

- **No remote/authentication/network:** finish independent local work. Preserve
  commits and the PR body, record pending delivery and report the actionable
  blocker. Do not ask for credentials in chat.
- **Push returned ambiguously:** use a single `git ls-remote REMOTE
  refs/heads/BRANCH` read and compare its SHA to local HEAD. If the read fails,
  leave push status unknown. An observed mismatch needs diagnosis, not force.
- **PR create failed or returned no URL:** record `creation-uncertain`. Perform
  one lookup by head using **`--state all`**, inspecting owner and base as above.
  An open match supplies the URL; a closed or merged match records historical
  creation and requires reconciliation, not another create. Only a successful,
  untruncated empty result allows a single retry. If lookup
  also fails, stop publication pending; elapsed time does not authorize retry.
  Repeated uncertainty requires recovery later, never an automatic create loop.
- **Code changes after testing:** rerun affected local checks before pushing the
  new commit. Resume does not manufacture a test receipt for changed code.
- **User requests local only:** stop at local commits and report the branch and
  plan; no GitHub reads, push or PR creation unless subsequently requested.

Save recovery evidence locally using the plan reference's delivery-note location.
A note saying `created` without an observed URL/response is not evidence. Keep
successful, pending and uncertain states distinct. Never merge, mark ready,
release or close issues merely to make the workflow look finished.
