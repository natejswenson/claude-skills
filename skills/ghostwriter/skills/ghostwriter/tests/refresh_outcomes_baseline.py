#!/usr/bin/env python3
"""Re-freeze the outcomes baseline from the live publish log.

Projects ~/.claude/ghostwriter/published.jsonl down to the non-personal fields
(date/slug/lane/format/outcome/impressions — no urns, urls or post text) into
evals/baseline/outcomes/published-frozen.jsonl, then re-renders
expected-stats.md by running post_outcome --stats over the freeze.
Inspect the diff before committing both files together.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
OUT = SKILL / "evals" / "baseline" / "outcomes"
FIELDS = ("date", "slug", "lane", "format", "outcome", "impressions")


def main() -> None:
    live = Path.home() / ".claude" / "ghostwriter" / "published.jsonl"
    rows = [
        {k: r[k] for k in FIELDS if k in r}
        for r in (json.loads(l) for l in live.read_text(encoding="utf-8").splitlines() if l.strip())
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    frozen = OUT / "published-frozen.jsonl"
    frozen.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    stats = subprocess.run(
        [sys.executable, str(SKILL / "scripts" / "post_outcome.py"), "--stats", "--log", str(frozen)],
        capture_output=True, text=True, check=True,
    )
    (OUT / "expected-stats.md").write_text(stats.stdout, encoding="utf-8")
    print(f"re-frozen {len(rows)} records + expected-stats.md")


if __name__ == "__main__":
    main()
