# Paired native pilot

The offline harness uses local Git, real test processes and synthetic provider /
worker outputs. `harness.mjs --mode native` is deliberately unsupported: it must
not silently run offline and label that a native result.

Run a separate campaign in explicitly authorized disposable repositories using
both installed host adapters. Capture 18 runs per host: baseline and candidate
pairs for three tasks (small docs/handoff, behavioral fix, complex generated-file/stacked
work), each repeated three times. Run interrupted startup, CI failure, retarget and
deployment fault scenarios separately before this pilot. Keep task, starting commit,
requested endpoint, model/settings and cache state identical within each pair.
Counterbalance execution order. Retain failures, pauses and unsupported outcomes.

For each run capture the installed source snapshot/hash, the native parent and
child transcripts, controller state, verification receipts, native terminal and
usage observations, CI/PR/provider receipts and endpoint/cleanup state. Record
controller interventions and user decisions. Do not claim success from a worker
summary or call model quality measured by an offline simulation.

Create a manifest with `schema: 1, runs: [...]`. Each row has `id`, `host`
(`claude|codex`), `variant` (`baseline|candidate`), `task`, `endpoint`, `startState`,
`modelSettings`, `cacheState`, `repetition` (1–3), `sourceHash`, and `evidence`. Every evidence item is
`{kind: "source"|"transcript"|"endpoint", path, sha256}`. Include all three kinds;
paths refer to retained captured bytes. Import from the repository checkout:

```bash
node "$SKILL_DIR/evals/native-pilot.mjs" --manifest <manifest.json> --out <new-report.json>
```

The importer checks unique identities, required pairing metadata and hashes. A
count threshold only admits analysis; it never establishes a speed/quality claim.
Compare end-to-end elapsed time, first implementation, reviewed PR and requested
endpoint separately. Use interval union for concurrent workers, identify CI and
human waits, and leave absent usage/cost unknown. Inspect all failed or unsupported
pairs before claiming a gain. The committed empty campaign reports both hosts
unverified; no native campaign was fabricated for this implementation.

To audit transcripts, use the eval CLI with `trace --bundle <sources.json>`.
Sources explicitly identify `path`, `sessionId`, and optional `parentId`; include
all child sources available for the run. It preserves origin anchors, timestamps,
call IDs and structured process facts before clipping. Repeated inherited call
records are deduplicated only when identity and content match. JavaScript and shell
text from a transcript are never executed. Missing child evidence stays unknown.
`contract --references <loaded-references.json>` binds referenced PRESS/runtime
instructions by `path`, `sha256`, `loadedAt` event and optional `label`; a missing
or changed reference is not silently substituted with the latest installed file.
