# Design security review

Status: design review, not a penetration test or independent-agent audit.

| Attack or failure | Resolution in this design | Implementation gate |
|---|---|---|
| A skill tag is mistaken for access control | Shared vault is readable by trusted connected clients; narrowly shared legacy records stay put | No real writing-bridge migration until sharing boundary is resolved |
| A source-owned preference acquires a second writer | Source-first owner bridge; Devlog only consumes voice preferences | Competing writers, stale revision and crash-boundary tests |
| A website or note claims permission to publish, delete or release | Memory is untrusted evidence and never authorization | Adversarial notes cannot reach action gates |
| Search hits miss a correction | Exact-key replacement lookup with explicit unresolved outcome on bounds | Hidden replacement and conflicting-active-note fixtures |
| Another repository gets the user's preferences | Registered context and exact key validation; no guessed project | Same-name clone and unregistered-worktree fixtures |
| Retry creates duplicate records or overwrites a correction | Stable operation ID, same-payload retry, read-back and conflict state | Lost response and concurrent save tests |
| Forget is reversed by reconciliation | Persistent source-event suppression; source and backup retention disclosed | Restart/reconcile/restore tests, no silent resurrection |
| Private content reaches a public PR or report | Exact final-artifact inclusion review, no automatic export | Canary note must not appear in public sink output |
| Tests or package output include personal records | Fake homes/transports, publish allowlists, actual archive inspection | Real-home/network access forbidden in adapter tests |
| Offline memory is reported as absent facts | Distinct unavailable/empty/conflict states | Disconnected tools and invalid metadata fixtures |
| Existing source facts are replaced with stale notes | Live/source owners remain authoritative | Résumé, release, stats, mail and network negative cases |
| Generic tools bypass the owner writer | New ownership guards required before owner namespace rollout | Enumerate/test every exposed mutation path; otherwise defer |
| Privacy labels promise protection they do not enforce | Labels are classification only; no isolation claim | Review actual client/filesystem threat model |
| New docs imply deployed functionality | Explicit proposed status and no SKILL.md runtime hook changes | Final diff contains design files only |

Residual limitations: a trusted broad-access local client can exfiltrate anything it can read;
a private vault is not encrypted merely because Git ignores it; model compliance cannot
provide deterministic semantic redaction; backups and prior publications may retain data.
This proposal reduces collection and avoids moving restricted source data into that boundary.
The existing repositories' historical contents were not audited for leaks in this task.

Do not implement all integrations in one migration. The low-risk advisory pilot validates
protocol and usability; the writing bridge has an additional, blocking privacy/parity gate.
