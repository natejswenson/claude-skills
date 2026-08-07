A deliberately empty repo fixture.

The baseline runs `issueflow` with `--repo` pointing here so `resolvePolicy` finds
no `.github/shipflow.json` and falls back to defaults — the path every repo that
has not adopted shipflow takes. It must exist as a real directory; git does not
track empty ones.
