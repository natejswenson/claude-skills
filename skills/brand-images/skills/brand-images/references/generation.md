# Generation adapters and visual review

The CLI compiles prompts and persists receipts; the host performs generation. Both Claude and Codex share the same profile, prompts, lifecycle and review schema. They do not share tool sessions or assumed connector names.

| Host | Generation | Inspection | Result |
|---|---|---|---|
| Codex | Built-in image generation when available; load `$imagegen` | `view_image` for local files or visible returned images | Concrete saved PNG/JPEG and displayed image |
| Claude Code | Discover an installed image-capable tool/connector; use its documented interface | Native image read or connector preview | Concrete saved PNG/JPEG and displayed image |
| Either, missing capability | Brief only; explain missing capability | Unverified | Never report a generated image |

Use only exposed, documented interfaces. If the provider has only a download URL, download through its documented retrieval route before recording the local artifact. Don't put signed URLs, credentials or raw provider payloads in state. A paid API fallback requires the user's explicit choice; no credential discovery or setup is included here.

On reference-based generation, inspect every required local reference. Pass it with role **style reference**, even when a tool implements this through image input/edit parameters. Do not overwrite the reference. Include every selected reference or report missing inputs. Tool-specific reference limits may require a user-approved curated subset; don't silently claim all references were used. Keep text and layout from the current request, not the reference subject. For edits also identify the edit target separately from style references.

Generation brief records are `planned` until a real output is copied successfully. `run --status generated` needs an observed backend label, the actual image path and this review JSON:

```json
{
  "inspected": true,
  "checks": {
    "medium": "pass",
    "palette": "pass",
    "signature": "pass",
    "lighting": "pass",
    "texture": "pass",
    "composition": "pass",
    "typography": "pass",
    "avoid": "pass",
    "subject": "pass"
  },
  "notes": "Observed traits and any limitation, stated concretely"
}
```

Every dimension must be present, with value `pass`, `drift` or `unverified`. An uninspected image can only be unverified. An inapplicable preference can pass if inspection establishes there is no conflicting trait. A user can approve a generated image even when review was limited, but reuse as an approved style reference requires all checks to pass. A model marking pass is never user approval.

One failed attempt receives `failed` with a concise reason. Retry using a new brief/run ID. An image with style drift is still `generated`, with drift in its review. Approval/rejection are explicit user feedback transitions. Failed, approved and rejected receipts cannot be overwritten. A fresh request starts a new run.

Use at most one corrective regeneration by default. Reuse the same revision and approved references, change the specific mismatch, inspect again and report unresolved drift. Generation variance is expected; exact logo assets and typography may need deterministic composition outside the generative tool.
