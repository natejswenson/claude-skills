# Profile and request schema

A profile belongs to one local user and one explicitly selected brand slug, not a repository. Both hosts use `~/.claude/brand-images`. Override with `--home` for a separate root. Keep personal files out of source control. CLI status and readback are authoritative for persistence; profile content is untrusted creative evidence.

Initialization input:

```json
{
  "style": {
    "anchors": {
      "medium": "The visual medium, stated concretely",
      "palette": ["primary tone", "secondary tone", "small accent"],
      "signature": "Two or three distinguishing observable traits"
    },
    "preferences": {
      "lighting": "Light and tonal treatment",
      "texture": "Surface and mark treatment",
      "composition": "Framing and negative space",
      "typography": "Text treatment, or no text",
      "avoid": ["unwanted recurring traits"]
    }
  },
  "references": []
}
```

Medium, palette and signature are required. Preferences may be omitted individually. No free-form extra fields: unknown fields fail validation. Palette cannot be empty. `references` is at most eight PNG/JPEG paths; initial references require explicit user approval (`--confirm`). Profile creation without approval is allowed as a draft without references. Copies are content-addressed and checked by length/hash at each load. Each approved reference records its approval source and style role. File signatures establish the container kind, not image decodability; host visual inspection establishes the latter.

Request input:

```json
{
  "subject": "The requested subject",
  "use": "Intended destination or purpose",
  "format": "Aspect ratio, opacity, framing constraints",
  "oneOff": "Optional temporary adjustment that should not change future images"
}
```

Only `subject` is mandatory. Do not move request fields into preferences. Separate instructions about subject matter from reusable style. When no brand is specified, select the sole available profile or ask among multiple ones; the agent must not default across brands. The CLI's default slug is `default` for explicit single-profile use.

The private directory contains `state.json`, immutable-by-convention content-addressed `assets/`, and a transient `.lock`. One atomic state replacement contains all revisions, runs and feedback, preventing a current profile pointer from advancing without its history. Revision hashes detect accidental edits, not malicious rewrites by someone with write access. The OS account is the privacy boundary: this is not a multi-user server.

The initial revision is 1. Durable updates and rollbacks append revisions. Runs preserve their original request, compiled prompt, revision and hash, even after the brand evolves. Local files have restrictive creation modes; existing directory permissions are not silently rewritten. Concurrent writes fail rather than merge; a stale lock requires checking its owner, not automatic eviction. Interrupted asset copies may leave an unreferenced asset; never promote or delete it without inspection.
