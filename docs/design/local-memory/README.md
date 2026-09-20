# Skill adapter design index

Status: proposed, design only; accuracy revision 2. Inventory: all 22 top-level plugins in claude-skills.

Four priority candidates, seven optional advisory integrations, and eleven deferred skills. No adapters or personal-data migrations were activated.

Use the [shared contract](contract.md), [security review](security-review.md), [field policy](field-policy.md), [accuracy review](accuracy-review.md), and [machine-readable catalog](catalog.json) before any per-skill implementation. The local-memory repository at `docs/design/skill-adapters` owns the canonical designs; identical per-skill review copies live under each plugin’s `references/local-memory-design.md`. The catalog pins their SHA-256 digests and inspected skill source hashes.

## Assessment

| Skill | Recommendation | Design |
|---|---|---|
| appletv | Defer | [appletv](../../../skills/appletv/skills/appletv/references/local-memory-design.md) |
| bible-study | Optional advisory | [bible-study](../../../skills/bible-study/skills/bible-study/references/local-memory-design.md) |
| brandreport | Defer | [brandreport](../../../skills/brandreport/skills/brandreport/references/local-memory-design.md) |
| city-report | Optional advisory | [city-report](../../../skills/city-report/skills/city-report/references/local-memory-design.md) |
| devlog | Priority reader | [devlog](../../../skills/devlog/skills/devlog/references/local-memory-design.md) |
| eval | Defer | [eval](../../../skills/eval/skills/eval/references/local-memory-design.md) |
| ghfactory | Optional advisory | [ghfactory](../../../skills/ghfactory/skills/ghfactory/references/local-memory-design.md) |
| ghostwriter | Priority owner bridge | [ghostwriter](../../../skills/ghostwriter/skills/ghostwriter/references/local-memory-design.md) |
| ghostwriter-x | Priority owner bridge | [ghostwriter-x](../../../skills/ghostwriter-x/skills/ghostwriter-x/references/local-memory-design.md) |
| github-stats | Defer | [github-stats](../../../skills/github-stats/skills/github-stats/references/local-memory-design.md) |
| gmailtriage | Defer sensitive | [gmailtriage](../../../skills/gmailtriage/skills/gmailtriage/references/local-memory-design.md) |
| issuecreator | Priority advisory | [issuecreator](../../../skills/issuecreator/skills/issuecreator/references/local-memory-design.md) |
| issueflow | Optional advisory | [issueflow](../../../skills/issueflow/skills/issueflow/references/local-memory-design.md) |
| netwatch | Defer sensitive | [netwatch](../../../skills/netwatch/skills/netwatch/references/local-memory-design.md) |
| pluginsync | Defer | [pluginsync](../../../skills/pluginsync/skills/pluginsync/references/local-memory-design.md) |
| press | Defer | [press](../../../skills/press/skills/press/references/local-memory-design.md) |
| release | Defer | [release](../../../skills/release/skills/release/references/local-memory-design.md) |
| resume | Optional advisory | [resume](../../../skills/resume/skills/resume/references/local-memory-design.md) |
| shipflow | Defer | [shipflow](../../../skills/shipflow/skills/shipflow/references/local-memory-design.md) |
| shipreport | Optional advisory | [shipreport](../../../skills/shipreport/skills/shipreport/references/local-memory-design.md) |
| skillfactory | Optional advisory | [skillfactory](../../../skills/skillfactory/skills/skillfactory/references/local-memory-design.md) |
| skillhelp | Defer | [skillhelp](../../../skills/skillhelp/skills/skillhelp/references/local-memory-design.md) |

## Review scope

Inspected the root repository instructions, every shipped SKILL.md’s workflow/ownership landmarks, the current memory companion contracts, and selected persistence/validation implementation surfaces. This is an integration design assessment, not a complete code or privacy audit of every skill. No personal source files, real notes, mail, device captures or credential stores were used to construct examples.

## Implementation sequence

Start with the shared advisory contract and Issuecreator. Prove Ghostwriter backend parity with synthetic records before any owner-data move, then add the separately scoped X owner and Devlog reader. Optional integrations follow demonstrated use. The eleven deferred skills receive no runtime hook.

Each implementation change must preserve its existing baseline, add positive and negative synthetic adapter tests, and support both Claude and Codex. Desktop availability is capability-dependent; a shell bridge alone does not establish desktop support.

## Keeping the two repositories in sync

Contract identifier: `skill-memory-v1`. local-memory is canonical. For a design change, update the hub files and catalog digests, then update the matching claude-skills copies in the same review batch. Cross-repository PRs should name both source commits and the contract ID; pin the implemented protocol version rather than depending on matching branch names. Per-skill specs are not executable configuration.

This task creates local design files only. Publication, skill runtime changes, new bindings and migration are subsequent work.
