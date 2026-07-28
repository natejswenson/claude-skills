"""Baseline eval: replay real cached city bundles through the renderer, offline.

Offline, deterministic, $0 — runs in `ci / city-report` with the normal suite.

The existing unit tests exercise the pieces (fmt, charts, one metric at a time)
and tests/test_live.py exercises the real API but needs network, so it is opt-in
and cannot gate a release. Neither one answers the question that actually matters:
*given a real city's data, does the report still come out whole?*

The fixtures in evals/baseline/bundles/ are genuine artifacts from local runs on
2026-07-28 — the exact JSON `load.py` cached, unedited. Two cities on purpose:

  * Hawley, MN and Mapleton, ND are both small places. Small places are where
    this skill breaks: they fall out of the `_1` cubes that cover only 675
    places, and a manifest regression shows up there first while a big city
    still renders fine.

The nastiest failure mode this guards is the one recorded in the Data USA notes:
a retired cube returns HTTP 200 with zero rows rather than an error, so a metric
silently becomes blank or, worse, a partial sum gets reported as a real figure.
`build_metric` is supposed to mark that `available: False` with a reason. The
trap tests below assert it still does — pinning only the frozen bundles would
never catch it, because the frozen bundles have all 22 metrics present.
"""
from __future__ import annotations

import html as _html
import json
import re
from pathlib import Path

import pytest

import bundle as bundle_mod
import manifest
import report

ROOT = Path(__file__).resolve().parent.parent
BUNDLE_DIR = ROOT / "evals" / "baseline" / "bundles"
MANIFEST = json.loads((ROOT / "skill-invariants.json").read_text(encoding="utf-8"))
BASELINE = {b["id"]: b for b in MANIFEST["baseline"]}

BUNDLES = sorted(BUNDLE_DIR.glob("bundle-*.json"))


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def rendered_text(html: str) -> str:
    """Visible page text: scripts/styles dropped, tags stripped, entities decoded.

    Decoding matters — section titles like "Work & Commute" reach the page as
    "Work &amp; Commute", and scanning raw HTML for them gives a false failure.
    """
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S | re.I)
    return _html.unescape(re.sub(r"<[^>]+>", " ", text))


def test_baseline_corpus_is_present():
    """Anti-vacuity guard: an empty fixture dir must fail, not silently pass."""
    expected = BASELINE["cached-bundle-renders-whole"]["min_corpus"]
    assert len(BUNDLES) >= expected, (
        f"Found {len(BUNDLES)} frozen bundle(s) in {BUNDLE_DIR}, expected at least "
        f"{expected}. Every parametrized test below would silently run zero times."
    )


@pytest.mark.parametrize("path", BUNDLES, ids=lambda p: p.stem)
def test_every_manifest_section_renders(path):
    """A section that quietly stops emitting is the classic silent regression:
    the report still opens, still looks fine, and is missing a fifth of its data."""
    text = rendered_text(report.build_html(load(path))).upper()
    missing = [title for _, title in manifest.SECTIONS if title.upper() not in text]
    assert not missing, (
        f"{path.name}: report is missing section(s) {missing}.\n"
        f"The document still renders, so nothing else would have caught this."
    )


@pytest.mark.parametrize("path", BUNDLES, ids=lambda p: p.stem)
def test_every_headline_metric_reaches_the_page(path):
    """The masthead stat strip is the first thing a reader sees. A headline metric
    that is present in the data but absent from the page is a renderer regression."""
    data = load(path)
    html = report.build_html(data)
    absent = [
        m.key
        for m in manifest.headline_metrics()
        if data["metrics"].get(m.key, {}).get("available")
        and m.label.upper() not in html.upper()
    ]
    assert not absent, (
        f"{path.name}: headline metric(s) {absent} have data in the bundle but do "
        f"not appear in the rendered report."
    )


@pytest.mark.parametrize("path", BUNDLES, ids=lambda p: p.stem)
def test_no_placeholder_or_null_leaks_into_the_page(path):
    """Formatting bugs surface as literal 'None'/'nan' in a published report.

    Scanned against the rendered text, not raw HTML: 'None' legitimately appears
    inside inline CSS/JS (`display:none`) and in attribute values.

    Whole-word matching is required, not substring — 'nan' is a substring of
    "Finance", which is a real industry label in the economy section.
    """
    text = rendered_text(report.build_html(load(path)))
    leaks = [
        tok
        for tok in ("None", "nan", "NaN", "undefined", "{{")
        if re.search(rf"(?<![A-Za-z]){re.escape(tok)}(?![A-Za-z])", text)
    ]
    assert not leaks, (
        f"{path.name}: rendered report text contains {leaks}. A formatter returned "
        f"a raw Python/JS value instead of a formatted figure."
    )


@pytest.mark.parametrize("path", BUNDLES, ids=lambda p: p.stem)
def test_headline_figures_match_the_frozen_data(path):
    """Pin the actual numbers, not just their presence.

    A renderer that reads the wrong year, or the state benchmark instead of the
    place value, still produces a complete, plausible-looking page. Only
    comparing against the source bundle catches it.
    """
    import fmt

    data = load(path)
    html = report.build_html(data)

    # Scoped to the masthead stat tiles, NOT the whole document. Each headline
    # figure also appears in the trend tables further down (five times over, for
    # median income), so a document-wide `expected in html` check stays green
    # even when the masthead itself renders the wrong number — verified by
    # mutation: swapping the tile to show the STATE benchmark instead of the
    # place's own figure did not fail a document-wide check.
    tile_values = set(re.findall(r'<span class="value">([^<]*)</span>', html))
    assert tile_values, f"{path.name}: no masthead stat tiles rendered at all"

    checked = 0
    for m in manifest.headline_metrics():
        metric = data["metrics"].get(m.key)
        # `latest` is the headline figure the masthead renders; the bundle has no
        # `value` key. Reading the wrong field would make this loop skip every
        # metric and pass while asserting nothing — which is exactly what it did
        # before this was caught, so the `checked` floor below is not decoration.
        if not metric or not metric.get("available") or metric.get("latest") is None:
            continue
        expected = fmt.format_compact(metric["latest"], metric["unit"])
        assert expected in tile_values, (
            f"{path.name}: {m.key} is {expected} in the frozen bundle, but no "
            f"masthead stat tile shows that figure. Rendered tiles: "
            f"{sorted(tile_values)}.\nThe masthead is showing a different number "
            f"than the data says — a wrong year, or a benchmark in place of the "
            f"city's own value."
        )
        checked += 1

    assert checked >= 6, (
        f"{path.name}: only {checked} headline figure(s) were actually compared. "
        f"This test asserts nothing when the metric field it reads is missing or "
        f"renamed — if the bundle schema changed, fix the field name here rather "
        f"than letting the loop skip."
    )


def test_comparison_report_renders_from_two_real_bundles():
    """The --vs path has its own renderer (build_comparison_html) that no other
    offline test drives end to end with real data."""
    a, b = load(BUNDLES[0]), load(BUNDLES[1])
    text = rendered_text(report.build_comparison_html(a, b))
    assert a["place"]["name"] in text and b["place"]["name"] in text
    missing = [t for _, t in manifest.SECTIONS if t.upper() not in text.upper()]
    assert not missing, f"comparison report missing section(s) {missing}"


# ------------------------------------------------------------------ the trap half
# Data USA returns HTTP 200 with zero rows for a retired cube instead of an error.
# The frozen bundles cannot exercise this (all 22 of their metrics have data), so
# these drive build_metric directly. Without them the golden checks above would
# keep passing while the skill silently started publishing blank or partial figures.


def test_a_cube_returning_zero_rows_is_marked_unavailable(place, make_payload):
    """HTTP 200 + zero rows must become `available: False`, never a blank figure."""
    data = bundle_mod.build_bundle(place, {"Place": make_payload([])})
    unavailable = [k for k, v in data["metrics"].items() if not v["available"]]
    assert len(unavailable) == len(data["metrics"]), (
        "A payload with zero rows left some metrics marked available. A dead cube "
        "would be published as though it carried real data."
    )
    assert all(
        data["metrics"][k]["reason"] for k in unavailable
    ), "An unavailable metric must carry a reason so the report can say why."


def test_an_unavailable_metric_never_prints_a_figure(place, make_payload):
    """The other half: unavailable must also mean nothing numeric reaches the page."""
    data = bundle_mod.build_bundle(place, {"Place": make_payload([])})
    text = rendered_text(report.build_html(data))
    assert not re.search(r"\$[\d,]+|\d+\.\d+%", text), (
        "A bundle in which every metric is unavailable still rendered currency or "
        "percentage figures. Those numbers cannot be real — they are formatter "
        "defaults being published as data."
    )


def test_availability_actually_depends_on_the_data(place, make_payload):
    """Guard against `available` collapsing to a constant.

    If it were hardcoded False the two trap tests above would pass for entirely
    the wrong reason. The positive case deliberately uses a real frozen bundle
    rather than a synthetic payload: constructing a valid one means hand-building
    the manifest's query keys, which would make this test a mirror of the code it
    is supposed to check.
    """
    empty = bundle_mod.build_bundle(place, {"Place": make_payload([])})
    assert not any(v["available"] for v in empty["metrics"].values())

    real = load(BUNDLES[0])
    assert all(v["available"] for v in real["metrics"].values()), (
        f"{BUNDLES[0].name} is a real cached run in which every metric had data. "
        f"Some are now marked unavailable, so either the fixture was edited or "
        f"build_metric stopped recognising data it used to accept."
    )
