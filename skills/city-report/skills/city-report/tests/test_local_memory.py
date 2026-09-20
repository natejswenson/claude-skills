"""Keep shared-validator fixtures aligned with the actual metric manifest.

Value rejection is exercised by the hub's integration tests. This suite neither
reimplements that validator nor claims to execute the agent's prose hook.
"""
import json
from pathlib import Path

from manifest import METRICS_BY_KEY

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT / "references/local-memory-cases.json").read_text())


def test_allowed_metric_fixtures_cover_current_manifest():
    orders = [case["value"] for case in CASES["allowed"]
              if case["key"] == "city-report.metric-order"]
    assert orders
    assert any(set(order) == set(METRICS_BY_KEY) for order in orders), (
        "Update the full metric-order fixture and shared hub vocabulary together "
        "when changing the manifest."
    )
    for order in orders:
        assert 1 <= len(order) <= 22
        assert len(set(order)) == len(order)
        assert set(order) <= set(METRICS_BY_KEY)


def test_unknown_metric_fixture_stays_unknown():
    assert "invented_metric" not in METRICS_BY_KEY
    assert {"key": "city-report.metric-order", "value": ["invented_metric"]} in CASES["rejected"]
