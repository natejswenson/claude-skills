# The run layout

Every brandreport run is one directory, created by `brandreport init`:

```
<run>/
  subject.json        who this run is about: { subject, slug, created }
  snapshots/          the corpus — every artifact the discovery fetched
    s1.md             the artifact's content, extension preserved from the fetch
    s1.meta.json      its provenance sidecar (see below)
  findings.json       what the model concluded, every claim citing snapshot ids
  report.html         the rendered report — written only when the gate is clean
```

## The provenance sidecar

Each snapshot's `.meta.json` is written by `brandreport add` and never edited
by hand:

| Field | Is |
|---|---|
| `id` | `s1`, `s2`, … — the citation key everything in `findings.json` uses |
| `url` | where the artifact was fetched from |
| `kind` | `profile`, `site`, `post`, `mention`, or `search` |
| `platform` | hostname-derived unless `--platform` names it better |
| `title` | what a reader would call this artifact |
| `status` | `confirmed` (tied to the person) or `unconfirmed` (same name, no tie) |
| `corroboration` | confirmed only — the recorded signal that tied it: a cross-link, a shared handle, a bio match. **Required**; `add` refuses a confirmed artifact without one |
| `why` | unconfirmed only — why it could not be tied. Equally required: unconfirmed findings are listed, never silently dropped |
| `fetchedAt` | ISO timestamp of the fetch; the report is dated by the newest of these, never by the clock |
| `file` | the content file next to this sidecar |

A re-run refreshes rather than duplicates: `add --id s2` replaces that
snapshot's content and provenance in place, keeping the citation key so
`findings.json` keeps resolving. A refresh may never flip `status` — deciding
a hit's identity differently is a new judgment, filed as a new snapshot.

## findings.json

```json
{
  "subject": "…",
  "claims":      [ { "id": "c1", "text": "…", "sources": ["s1", "s2"] } ],
  "read": {
    "themes":    [ { "name": "…", "text": "…", "sources": ["s1"] } ],
    "gaps":      [ "…" ],
    "summary":   "…"
  },
  "unconfirmed": [ { "note": "…", "sources": ["s7"] } ]
}
```

- **claims** — factual statements about the person's presence. Every claim
  cites ≥1 confirmed snapshot; `gate` fails on a dangling or unconfirmed cite.
- **read** — the brand analysis. Themes cite their evidence like claims do.
  `gaps` cite nothing: a gap asserts absence, and there is no snapshot of a
  thing that does not exist.
- **unconfirmed** — the same-name residue. Every unconfirmed snapshot must
  appear in exactly this section; listing a confirmed one here is a gate
  violation in the other direction.
