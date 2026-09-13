# Issueflow completion fixes — evaluation of actual runs

**Result: the three requested PR outcomes were reached, but the original candidate was not a hands-off pass.** The campaign exposed defects, produced seven local repair groups, and still has two unresolved behaviors. This is evidence from native Codex workers and real GitHub operations in [fuzzy-boom-snicker](https://github.com/natejswenson/fuzzy-boom-snicker), not a simulated success report.

The scored contract evaluation has **4 judgment findings, 0 machine findings, and a coverage gap of 100 of 109 clauses**. The broader observations below include controller behavior and eval-tool defects; they are not extra scored contract violations. No native performance improvement is established.

## Actual outcomes

All runs used `dev` at `1e4dcd1128ee3a45854da754d899044e23cbd3ed`, the same fixture base used previously. Each received a native plan, independent plan review, native implementation, controller verification, and native PR review. The parent supplied clarifications and repaired controller defects where described below. PRs remain open and unmerged.

| Run | Actual PR and final head | Observed proof | Endpoint |
|---|---|---|---|
| Falsy/repeated values, issue #11 | [PR #15](https://github.com/natejswenson/fuzzy-boom-snicker/pull/15), `00b748874b51792accf183ca80afb61b59727bfc` | Regression: 3 failures on base, 6 passing assertions on fix; full suite 7 passed; hosted `test` succeeded | Reviewed and ready; unmerged |
| Zero cap, issue #12 | [PR #14](https://github.com/natejswenson/fuzzy-boom-snicker/pull/14), `0255e978bc0bd1587904893a252b85ae3ca6d1c3` | Regression: 1 failure on base, 9 passing assertions on fix; full suite 10 passed; targeted command ran from `test/`; hosted `test` succeeded | Reviewed and ready; unmerged |
| Docs plus published amendment, issue #13 | [PR #16](https://github.com/natejswenson/fuzzy-boom-snicker/pull/16), `f23a5cf9426b3153692dc96f229927c64d1b70f2` | README check, troubleshooting check, full suite 2 passed; hosted `test` succeeded on amended head | Two posted reviews; remains draft; unmerged |

The amendment preserved PR #16 and its original review, changed the approved contract, reopened implementation/verification/review, and obtained a [second review on the new head](https://github.com/natejswenson/fuzzy-boom-snicker/pull/16#pullrequestreview-5189557277). The initial batch `cdba18a1-f5df-4b0f-b112-079d62a379f3` was replaced by `26028479-6db4-4772-bf6d-476d0f3dad75`; both remain available. The original 14,400-second cumulative cap and four-review limit were retained. One autonomous window renewal was recorded after the controller repair.

All three final run records now contain `completion.state: complete`. The counting and cap persistence replays also exposed the terminal exit-status defect below. Successful GitHub outcomes therefore do not imply every controller invocation succeeded.

## Findings and repairs

The clause/event references resolve against the frozen candidate and raw transcript bundle. Full citation hashes and raw line numbers are in the [machine-readable evidence](2026-09-12-issueflow-completion-live-evaluation.json) and [scored eval report](/private/tmp/issueflow-completion-live-20260912/evals/report/report.md).

| Scored finding | Contract and actual event | Change and verification |
|---|---|---|
| Cold planner lacked a complete preflight command | Complete cold-brief promise, `manual-da21bbb6`; `e481`, native cap planner, raw line 47 | Brief now includes loaded CLI, canonical run directory and actual plan path. A new regression failed before repair. An independent native worker ran the exact repaired command from unrelated `/private/tmp`: exit 0, preflight `ok: true`. |
| Ready handoff asked for an excluded merge | Persisted endpoint exclusions prevail, `manual-571cd790`; `e738`, parent raw line 1988 | Ready output respects the recorded endpoint. Actual replay on PR #14 removed the merge request and retained the same review/comment IDs. A follow-on draft-only review-post message was corrected locally; replay was safely refused as already posted, so that wording has no fresh native publication proof. |
| Newly dispatched amendment worker immediately called stalled | Never claim an unobserved result, `inv-594a0c05`; `e858`, parent raw line 2198 | Heartbeat age now starts no earlier than the new brief. The old progress log is retained as evidence. Regression failed with the actual “12 minutes” symptom before repair; all 62 runtime tests then passed, including real-stall controls. |
| Autonomous run stopped at a renewable window | Automatic bounded renewal, `manual-c73f2a9b`; `e960`, parent raw line 2421 | `next` now applies the recorded renewal policy before returning its budget stop. The frozen candidate failed the reproduction; repaired autonomous, manual and spent-cap controls passed. Actual replay renewed within the existing cap and posted the already-delivered second review. |

**Coverage alongside these findings: 4 scored findings; 100 of 109 clauses remain outside scored coverage.** Findings are not a complete count of possible defects.

Three additional repair groups came from direct evidence:

- **Context-hash instructions:** two native reviewers compared raw file SHA-256 with the canonical `packetHash`. One resolved it independently; the amendment reviewer required clarification. Briefs now name `verifyContextPacket` and explain hashing parsed JSON without `packetHash`. Official verification passed on both original packets. The clarification is fixed in generated instructions; a new native review using those repaired instructions was not run.
- **Completion persistence:** the controller returned `reviewed` while the stored completion state remained pending. It now reconciles and records the reviewed endpoint before its terminal handoff. A failing regression became green; actual replays set all three states to complete without merging or lifting the draft.
- **Eval announcement false positive:** the original probe rejected “using the issueflow and eval skills.” The repaired probe recognizes a bounded list of named skills while preserving unrelated-mention and repeated-announcement controls. The original finding remains in `probe-initial.json`; the repaired probe reports no machine findings among its six examined clauses, leaving 100 of the original 106 unexamined. The regression failed before repair; all 88 eval tests passed afterward.

The controller correctly refused an operator call with the wrong observation flag and another using a telemetry wave ID instead of the harness attempt ID. Both were retried using the actual harness identity. These are retained operator errors, not hidden as controller successes. Native usage remains unknown; token or cost numbers were not inferred from artifact sizes.

## Remaining work

| Priority | Observed behavior | Evidence and concrete next fix |
|---|---|---|
| High — accuracy and speed | An otherwise identical README command is classified as behavioral when its code fence has a `sh` label, but accepted as docs without the label. | Command `3b335ac9-cf12-42aa-97cf-c7d05aa9f99c`, event `e647`, refused the native implementation. A native repair removed only the optional fence label. Preflight and independent plan review had accepted the planned content check, which allowed either form. Make classification depend on substantive command/content risk, retain safeguards for actual executable/automation changes, and test both equivalent fence forms before changing the policy. |
| High — resilience and UI | Recording a completed review endpoint after the current window expires returns exit 4 even though the endpoint is persisted complete and output says `reviewed`. | Actual commands `6f7682f9-6858-471f-b274-f93f36bb2db0` and `9fa76bb4-e07f-42ce-b513-f205992cb5e3` completed cap/count reconciliation but exited 4. The post-action expiry branch routes terminal success through `checkpointBudgetStop`. Exclude successful terminal outcomes from that branch, add a CLI regression for completed-vs-pending work at expiry, and rerun the expiration case before calling completion recovery clean. |

These remain open. The test PRs do not need merging to reproduce or fix either behavior.

## What this establishes across the four requested areas

| Area | Evidence | Limit |
|---|---|---|
| UI/UX | Concrete PR handoffs, retained draft intent, repaired preflight command, corrected merge prompt, recorded coverage gaps | False stalled/budget messages required intervention; terminal exit status remains inconsistent |
| Speed | First review endpoint: count **789.032 s**, cap **760.509 s**, docs **996.647 s**. Amended docs review endpoint: **2079.209 s** from original start | Concurrent work, parent attention, repairs and evaluation pauses are included. Prior same-repo runs took 592.466/608.049/667.044 s, but prompts, versions and conditions differ. These are unpaired observations; no speedup or cost claim is justified |
| Accuracy | Real red-before-green behavioral tests, explicit test cwd, fresh hosted checks, review heads match GitHub, new amendment contract and verification batch | Formatting-sensitive docs classification remains; zero finder candidates did not exercise verifier/fixer disputes |
| Resilience | Injected initialization failure resumed the same owner/run with frozen input; amendment preserved PR/review history; duplicate review-post was refused; ready replay retained identities; bounded renewal replay succeeded | No live retarget, merge, deployment, lost-write response, controller crash during a remote mutation, or Claude-host run |

## Spec coverage

| Package | Native evidence in this campaign | Still outside this campaign |
|---|---|---|
| P01 | Failure after frozen inputs; same-session `start` recovery; native completion receipts | Host death, ownership races, cancellation/redispatch fault matrix |
| P02 | One common selected SHA across planning, implementation and verification | Moving-base race, conflicting policy, bare-store cleanup, retarget |
| P03 | Real regression execution and non-root cwd; docs preflight failure exposed | Generator prerequisites, dependency installation; docs risk mismatch remains |
| P04 | Current-head hosted CI and fresh post-amendment observation | Optional skipped checks, collisions, missing requirements, retarget races |
| P05 | Reviewed-ready and reviewed-draft endpoints; explicit ready refusal; persistent completion replay | Merge/deploy/companion completion; expired terminal exit remains |
| P06 | Actual milestones and final state; heartbeat defect reproduced and repaired locally | Broad UX pacing comparison across hosts; no exhaustive presentation grade |
| P07 | Independent native plan reviews, existing review limits retained | Repeated blockers, repair omission, dispute convergence and cap exhaustion |
| P08 | Real published amendment, retained PR and review, invalidated old gates, fresh implementation/review | Retarget, stale-authority races, partially applied remote amendment |
| P09 | Actual parent/child capture, anchored clause/event grade, preserved false-positive evidence | Paired performance pilot; complete token/cost attribution; most clauses unscored |
| P10 | Shared-source tests, Claude/Codex compatibility and manifest drift checks passed | Native Claude campaign, installed-release replay, release dispatch |

## Provenance and validation

The campaign retained 19 native session captures: the parent, 16 harness stage/review workers, a native amendment-proposal author, and the independent handoff validator. The scoped grade contains 606 events: 19 user, 50 assistant, 269 tool-use and 268 tool-result. Normalization discarded 2,477 bookkeeping and 340 thinking records across the full captured sources, with zero unparsed records; those drop counts include the earlier parent prefix excluded from grading. The snapshot has an explicit cutoff and does not pretend the still-active parent conversation is closed.

The extractor produced 106 clauses. Three missed commitments were manually anchored to exact frozen SKILL/template source, yielding 109: 5 house, 19 invariant, 81 loaded-reference and 4 skill/template clauses. Loaded references carry content hashes and transcript load anchors. Many extracted references are line fragments, including duplicated bold/plain presentation rules; the denominator is not 109 independent behaviors. Opaque `functions.exec` calls remain execution-unknown. Raw source lines and separately hashed process logs were inspected for the judgments; clipped trace previews were not treated as complete command output.

The original candidate was kept immutable: aggregate source identity `6488e8ac0a6b7ed92127caa481b31f1136cd242e4083b60226a4a24168db288b`. The final repaired source is `096860d03b9d24533c20b0e292dfbcf70a3993a5fd739933721c89661c3deaf7`. Intermediate repair snapshots are retained separately. Every file still matches its captured manifest. Only targeted repair paths changed between the original and final issueflow/eval snapshots.

Final validation: **542/542 Issueflow tests**, **88/88 eval tests**, Claude/Codex compatibility, generated Codex metadata drift, Issueflow structural/plugin validation, and the generated skillhelp index all passed. Running the complete suite inside a copied package initially failed because repository-dependent tests require the monorepo `.git`; the final suite was rerun successfully in the actual checkout. That failed attempt is retained, not counted as a pass.

The local evidence root is [/private/tmp/issueflow-completion-live-20260912](/private/tmp/issueflow-completion-live-20260912). It contains immutable source copies/manifests, exact command logs, raw native transcript captures, frozen contracts, atomic deliveries, verification receipts, GitHub readbacks, before/after regressions, and the generated eval report. Raw transcripts stay local; this document and its JSON companion are the reviewable repository artifacts. The original [paired-pilot report](2026-09-12-issueflow-native-pilot-report.json) remains unverified and is not replaced by these unpaired runs.

No merge, deployment, release, or source publication was performed.
