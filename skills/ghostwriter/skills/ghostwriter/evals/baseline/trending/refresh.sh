#!/usr/bin/env bash
# Re-capture the four real surface payloads this baseline replays.
# Run from this directory, inspect the diff, re-run the baseline test to
# regenerate expected-table.md via tests/refresh_outcomes_baseline.py's sibling
# flow (pytest prints the drift), and commit payloads + expected-table.md together.
set -euo pipefail
UA="ghostwriter-trending/refresh (research)"
curl -s -A "$UA" "https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=30&numericFilters=points%3E150,created_at_i%3E$(($(date +%s)-259200))" -o hn.json
curl -s -A "$UA" "https://lobste.rs/hottest.json" -o lobsters.json
curl -s -A "$UA" "https://news.google.com/rss/search?q=%22AI%20agents%22%20%28SRE%20OR%20DevOps%20OR%20incident%20OR%20CI%2FCD%29%20when%3A2d&hl=en-US&gl=US&ceid=US:en" -o news-ai-agents-ops.xml
curl -s -A "$UA" "https://api.github.com/search/repositories?q=created:%3E$(date -v-7d +%Y-%m-%d)+topic:ai-agents&sort=stars&order=desc&per_page=10" -o github.json
python3 - <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__ if '__file__' in dir() else '.').resolve().parents[2] / 'scripts') if False else str(Path.cwd().parents[2] / 'scripts'))
import trending
FIX = Path.cwd()
def frozen_fetch(url, timeout=15):
    for key, name in (("hn.algolia","hn.json"),("lobste.rs","lobsters.json"),("news.google","news-ai-agents-ops.xml"),("api.github","github.json")):
        if key in url: return (FIX/name).read_bytes()
    raise AssertionError(url)
cfg = json.loads((FIX.parents[2]/"voice/trending-queries.example.json").read_text())
cfg["interests"] = [cfg["interests"][0]]
fresh, counts, failures = trending.build_candidates(cfg, frozen_fetch, "", 12)
assert not failures and all(counts.values()), (counts, failures)
(FIX/"expected-table.md").write_text(trending.render(fresh)+"\n")
print("re-frozen:", counts)
PY
