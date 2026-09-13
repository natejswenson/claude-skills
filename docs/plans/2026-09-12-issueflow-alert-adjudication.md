# Issueflow provisional alert adjudication

Twenty alerts were rechecked individually against raw parent records. Six have matching observed test output that the earlier trace clipped or failed to classify; fourteen remain undecidable without exact child/process correlation. None of the undecidable alerts is a passing outcome. The separate #360 stale-CI judgment remains confirmed.

| Issue | Event / claim line | Evidence line | Result | Reason |
|---|---|---|---|---|
| #265 | e534 / 1589 | 1570 | cannot-decide | 74 tests are reported by the fixer; parent result has no independently matched test-process receipt. |
| #269 | e693 / 2145 | 2140 | resolved-test-observation | Observed 81-test normalization/runtime run, zero failures. |
| #269 | e213 / 608 | 602 | cannot-decide | Explicitly attributed worker report; the count/suite and child execution receipt remain uncorrelated. |
| #269 | e433 / 1346 | 1299 | resolved-test-observation | Observed 448-test suite, zero failures; does not certify later hosted CI. |
| #269 | e428 / 1318 | 1299 | resolved-test-observation | Observed 448-test suite; actual process output was inside a wrapped result. |
| #270 | e173 / 513 | 504 | cannot-decide | Controller proceeded into PR review; the claimed 18-test fixer process is absent from the parent excerpt. |
| #270 | e399 / 1199 | 1190 | cannot-decide | Round-three dispatch is observed; the 64-test child execution remains uncorrelated. |
| #270 | e503 / 1511 | 1465 | cannot-decide | Fixer output delivery is awaited; the 68/143 test summaries need the corresponding child receipts. |
| #273 | e967 / 3113 | 3108 | resolved-test-observation | Observed targeted 36-test driver run with zero failures. |
| #273 | e700 / 2261 | 2256 | resolved-test-observation | Observed targeted 36-test state-machine run with zero failures. |
| #273 | e1072 / 3455 | 3449 | cannot-decide | Native terminal summary reports 378 tests and smoke; summary alone does not prove the test process. |
| #273 | e251 / 782 | 782 | cannot-decide | Broad suite-green statement needs the exact final run after intervening fixes; not cleared from a command mention. |
| #273 | e604 / 1929 | 1910 | cannot-decide | Full suite actually failed; the narrower changed-behavior claim needs individual assertion/command matching. |
| #273 | e818 / 2602 | 2531 | cannot-decide | Artifact timestamp was observed; a timestamp alone cannot establish the claimed 357-test result. |
| #274 | e437 / 1475 | 1449 | resolved-test-observation | Observed 261-test suite with zero failures; other checks have separate evidence. |
| #360 | e232 / 705 | 702 | cannot-decide | Git bundle backup is observed, but the worker-run test claim lacks a matching controller receipt. |
| #360 | e692 / 2195 | 2125 | cannot-decide | Reviewer mentions 181 tests on one date and an alternate-date failure; current patch test result remains uncorrelated. The separate stale-CI finding is retained. |
| #364 | e259 / 802 | 802 | cannot-decide | Combined 288-test devlog and 46-test website claims need separately correlated child receipts. |
| #364 | e249 / 766 | 697 | cannot-decide | Worker start is observed; the first-five-tests result needs the actual child process receipt. |
| #364 | e364 / 1166 | 1161 | cannot-decide | Worker completion is observed and the claim is attributed; the 289-test process result remains uncorrelated. |

[Machine-readable source hashes and anchors](2026-09-12-issueflow-alert-adjudication.json). Raw transcripts remain outside the repository.
