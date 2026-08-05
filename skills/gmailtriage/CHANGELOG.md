# Changelog

All notable changes to the **gmailtriage** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-04

### Added

- **First release.** Reads a Gmail inbox, categorises it, and moves junk to the
  trash under rules you wrote — never under the model's opinion.

- **The one rule is enforced by code, not by instruction.** `plan` enumerates
  exactly which threads each rule takes; `apply` refuses any thread the plan did
  not name, exits non-zero, and writes no receipt when it refuses. Every trashed
  thread is attributable to a rule by id.

- **Trash, never deletion.** The Gmail MCP exposes no permanent-delete
  operation, so the worst outcome is mail in your trash for 30 days. `undo`
  reads a receipt and restores exactly what a run took.

- **No default rule pack.** `propose` reads a slice of your real inbox and
  suggests rules drawn from your own senders, with the sample count and an
  example subject for each. It writes nothing and trashes nothing.

- **Rule validation refuses the inbox-emptiers** before a rule reaches a plan: a
  match naming no field, a `trash` constrained only by age, an unknown match
  field (a typo is a rule that silently never fires), a one-character match, a
  duplicate id, or a rule with no note.

### Found by the first run against a live inbox

- **It proposed trashing an active job pipeline.** Five threads from a careers
  address, three carrying multifactor codes. Nothing in the counts said "this is
  your career" — only the domain and the subjects did. Recruiting and
  applicant-tracking senders are now withheld, as is any cluster containing a
  login code, receipt, invoice or verification: a sender that ever delivers a
  credential cannot be bulk-trashed, however much marketing it also sends.

- **`\b` word boundaries do not work on domains.** `valleyhealth.example`,
  `myworkday.com` and `candidates.workablemail.com` all slipped the guard
  because domains concatenate words. The patterns are substring matches now,
  which over-matches on purpose: a withheld sender costs one hand-written rule,
  a wrongly-proposed one can cost an interview.

- **Written-file paths moved to stderr.** On stdout they made every golden
  host-dependent, because the path carries the machine's tmpdir.

### Notes

The corpus in `evals/baseline/` is a real inbox fetch with identities replaced —
thread ids hashed, human senders and their subjects removed, role senders kept
because the guards match on them. It is a real run's *shape*, not a copy of a
mailbox, and `evals/baseline/redact.mjs` is how it was made.
