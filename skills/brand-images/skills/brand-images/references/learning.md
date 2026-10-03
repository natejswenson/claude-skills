# Learning contract

Learning means a saved, versioned style profile plus user-approved references and explicit feedback. There is no weight training, autonomous taste discovery from silence, or guarantee of unique pixels. Specific observable traits and a user's reference set establish a recognizable identity; ask for more distinguishing choices if the starter direction is generic.

| User wording | Scope | Persistent style effect |
|---|---|---|
| "More texture in this image" | image | None; next brief only changes if the next request repeats it |
| "I like this" | approval | Marks the image approved; no reference or style update |
| "Maybe more texture?" | candidate | Saved suggestion, ignored by future briefs until clarified |
| "Always use rougher paper texture" | durable | Confirmed preference patch with exact source and current revision |
| "This is my style from now on" | durable, approve-style | Approves latest draft style after all visual checks pass |
| "Use this image as a style reference" | durable, approve-image | Adds the actual copied image to the reference set and approves the style |
| "Change my brand palette to these colors" | durable, rebrand | Explicit anchor patch, never a subject request |
| No feedback | none | Nothing learned, nothing approved |

The agent may propose new preferences from observed patterns, but saves them only as candidate feedback until the user explicitly approves. Don't append a user quote where a concise source note suffices. Never infer demographic information, reuse private references across profiles, or move this store into generic memory.

Durable patches are narrow JSON merge updates, not arbitrary state edits:

```json
{"preferences":{"texture":"Rougher paper grain with uneven ink coverage"}}
```

Only medium/palette/signature in `anchors` and lighting/texture/composition/typography/avoid in `preferences` are allowed. Arrays replace the entire prior array; preserve prior avoid-list entries unless the user removed them. Changes to approved anchors require explicit rebrand intent and `--rebrand`. An explicit selection of an onboarding image as the baseline may finalize draft anchors with `--patch --approve-image --review <fresh-review.json>`: review against the accepted attributes, keep the original run review, and save the new comparison in the feedback event. Patch plus approval requires a fresh review with all checks passing. Normal preference refinements do not. Unknown fields, missing confirmation, missing source, stale revision and unsupported state transitions fail without replacing state.

When feedback contradicts an existing preference, current explicit durable intent wins. Patch that attribute, record its source and keep the earlier revision. Ambiguous contradictions become candidates. If the user says "keep the style but add a red bicycle", keep the bicycle in the request, never in the palette or signature.

`--confirm` records explicit user authorization for the exact change. It is not a proof that the user said it; the agent must preserve that distinction. Inspection checks also reflect the agent's observations, not automated visual similarity scores.

Use a stable unique `--event <slug>` for each feedback event and retain the exact fields (including patch and expected revision) for any retry. Repeating an identical event returns `alreadyRecorded:true`; reusing it with different input fails. Without an explicit event ID the CLI generates one, so inspect history instead of blindly retrying.

Before a durable change, reload `profile show`. Pass its revision as `--expect`. A stale write fails; read the latest state and reconcile with the user instruction instead of forcing. On an uncertain transport result, use history/readback to see whether the requested feedback revision already exists before retrying. Never repeat a mutation just because the prior output was lost.

Rollback restores a prior revision as a new current one; history is retained. Export is a requested local directory copy, validated at the destination. Forgetting a complete profile deletes only its selected directory after explicit deletion authorization. No automatic retention purge, network sync or generic-memory capture is part of this skill.
