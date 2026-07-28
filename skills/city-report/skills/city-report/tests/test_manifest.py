"""Guard tests for the metric manifest.

``test_drilldowns_cover_every_dimension`` is the important one: it is what makes
the API's silent cross-dimension summing structurally impossible to reintroduce.
It runs against a recorded snapshot of the cube schemas offline, and against the
live API under ``-m live``.
"""
from __future__ import annotations

import json
import os

import pytest

import manifest

SCHEMA_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "cube_schemas.json")


def load_schemas() -> dict:
    with open(SCHEMA_FIXTURE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def non_geo_dimensions(schema: dict) -> set[str]:
    """Every dimension of a cube except Geography and Year.

    These are exactly the dimensions that must be drilled or explicitly pinned;
    anything left loose gets summed into the measure without warning.
    """
    out = set()
    for dim in schema["dimensions"]:
        if dim["name"] in ("Geography", "Year"):
            continue
        out.add(dim["name"])
    return out


def dimension_levels(schema: dict) -> dict[str, set[str]]:
    """``{dimension name: {level names}}`` for the non-geo dimensions."""
    out: dict[str, set[str]] = {}
    for dim in schema["dimensions"]:
        if dim["name"] in ("Geography",):
            continue
        levels = {lvl["name"] for h in dim["hierarchies"] for lvl in h["levels"]}
        out[dim["name"]] = levels
    return out


def test_every_metric_key_is_unique():
    keys = [m.key for m in manifest.METRICS]
    assert len(keys) == len(set(keys))


def test_every_metric_belongs_to_a_declared_section():
    sections = {k for k, _ in manifest.SECTIONS}
    for metric in manifest.METRICS:
        assert metric.section in sections, metric.key


def test_every_metric_drills_year():
    """Without Year the series collapses to one all-time aggregate."""
    for metric in manifest.METRICS:
        assert "Year" in metric.drilldowns, metric.key


def test_medians_are_never_totalled():
    """Summing or averaging a median is meaningless; the API will do it anyway."""
    for metric in manifest.METRICS:
        if metric.is_median:
            assert metric.kind != "total", metric.key


def test_member_and_rate_metrics_name_their_members():
    for metric in manifest.METRICS:
        if metric.kind == "member":
            assert metric.member, metric.key
        if metric.kind == "rate":
            assert metric.numerator, metric.key


def test_kinds_are_known():
    valid = {"scalar", "total", "member", "breakdown", "rate", "derived_median"}
    for metric in manifest.METRICS:
        assert metric.kind in valid, metric.key


def test_scalar_metrics_have_no_extra_drilldown():
    """A scalar metric's cube has no dimension beyond Year, so drilling one
    would mean the manifest disagrees with the schema."""
    for metric in manifest.METRICS:
        if metric.kind == "scalar":
            assert metric.drilldowns == ("Year",), metric.key


def test_counts_are_not_benchmarked():
    """A city's count compared to its state's is a nonsense ratio."""
    for metric in manifest.METRICS:
        assert metric.benchmarkable == (metric.unit != "count"), metric.key


def test_moe_measure_naming():
    """``Moe`` goes before a level suffix, not after the whole name.

    ``"Median Earnings by Industry: Industry Group"`` pairs with
    ``"Median Earnings by Industry Moe: Industry Group"``. Appending naively
    names a measure that doesn't exist, and the API answers that request with
    data and no MOE column rather than an error — so the margin vanishes
    silently.
    """
    for metric in manifest.METRICS:
        if ": " in metric.measure:
            head, _, tail = metric.measure.partition(": ")
            assert metric.moe_measure == f"{head} Moe: {tail}"
        else:
            assert metric.moe_measure == f"{metric.measure} Moe"


def test_no_dead_cubes_referenced():
    """These two return 200-with-no-rows and 500 respectively — see api-gotchas."""
    dead = {"acs_yg_total_population_5", "acs_yg_housing_median_value_5"}
    for metric in manifest.METRICS:
        assert metric.cube not in dead, f"{metric.key} uses dead cube {metric.cube}"


def test_all_cubes_are_five_year():
    """``_1`` cubes cover only 675 places; ``_5`` covers all 29,576."""
    for metric in manifest.METRICS:
        if metric.cube.startswith("acs_"):
            assert metric.cube.endswith("_5"), metric.key


def _uncovered_dimensions(metric, schema) -> set[str]:
    """Dimensions of ``metric``'s cube that its drilldowns do not reach."""
    levels = dimension_levels(schema)
    covered = set()
    for drill in metric.drilldowns:
        for dim_name, dim_levels in levels.items():
            if drill in dim_levels:
                covered.add(dim_name)
    return non_geo_dimensions(schema) - covered


def test_drilldowns_cover_every_dimension():
    """THE guard: nothing may be summed across without saying so.

    Tesseract aggregates a measure over every dimension you did not drill, and
    reports nothing about having done it. That is safe for a **count** on a
    crosstab — each person sits in exactly one cell, so the sum is the marginal
    total — and meaningless for a **median**, where it averages medians.

    So the rule this enforces is the one that matters, not a blanket ban:
    every uncovered dimension must be named in ``summed``, and a median may not
    have any uncovered dimension at all.
    """
    schemas = load_schemas()
    for metric in manifest.METRICS:
        missing = _uncovered_dimensions(metric, schemas[metric.cube])
        undeclared = missing - set(metric.summed)
        assert not undeclared, (
            f"{metric.key}: dimension(s) {sorted(undeclared)} of {metric.cube} "
            f"are neither drilled nor declared in `summed` — the measure will "
            f"be summed across them silently")


def test_medians_never_leave_a_dimension_uncovered():
    """Averaging medians is meaningless, and the API does it without complaint.

    ``median_age`` was caught by this: its cube carries a Gender dimension that
    the manifest originally left loose, so the headline median age depended on
    an implicit aggregate rather than the cube's own ``Total`` member.
    """
    schemas = load_schemas()
    for metric in manifest.METRICS:
        if not metric.is_median:
            continue
        missing = _uncovered_dimensions(metric, schemas[metric.cube])
        assert not missing, (
            f"{metric.key} is a median but leaves {sorted(missing)} uncovered — "
            f"drill it and pin a member instead of summing")


def test_declared_sums_carry_a_justification():
    """``summed`` is an escape hatch; it only works if it stays expensive to use."""
    for metric in manifest.METRICS:
        for dim, reason in metric.summed.items():
            assert len(reason) > 20, f"{metric.key}/{dim} needs a real reason"


def test_declared_sums_reference_real_dimensions():
    schemas = load_schemas()
    for metric in manifest.METRICS:
        names = non_geo_dimensions(schemas[metric.cube])
        for dim in metric.summed:
            assert dim in names, f"{metric.key}: no dimension '{dim}'"


def test_drilldown_names_exist_in_their_cube():
    """A misspelled level name is an HTTP 400, caught here instead of at runtime."""
    schemas = load_schemas()
    for metric in manifest.METRICS:
        levels = set()
        for dim in schemas[metric.cube]["dimensions"]:
            for hierarchy in dim["hierarchies"]:
                levels |= {lvl["name"] for lvl in hierarchy["levels"]}
        for drill in metric.drilldowns:
            assert drill in levels, f"{metric.key}: no level '{drill}' in {metric.cube}"


def test_measures_exist_in_their_cube():
    schemas = load_schemas()
    for metric in manifest.METRICS:
        names = {m["name"] for m in schemas[metric.cube]["measures"]}
        assert metric.measure in names, metric.key
        assert metric.moe_measure in names, f"{metric.key}: no MOE measure"


def test_unique_queries_deduplicates():
    """Metrics sharing a cube+drilldowns+measure must collapse to one request."""
    queries = manifest.unique_queries()
    assert len(queries) == len(set(queries))
    assert len(queries) < len(manifest.METRICS)


def test_helpers():
    assert manifest.metrics_for_section("people")
    assert all(m.headline for m in manifest.headline_metrics())
    assert manifest.METRICS_BY_KEY["population"].cube.endswith("_5")
    assert manifest.metrics_for_section("nonexistent") == ()


@pytest.mark.live
def test_live_schemas_match_the_fixture():
    """The recorded schemas still describe the live cubes.

    Drift here means Data USA changed a cube under the manifest — which is
    exactly the event the offline guard cannot see.
    """
    import urllib.request

    recorded = load_schemas()
    for cube in sorted({m.cube for m in manifest.METRICS}):
        with urllib.request.urlopen(
                f"https://api.datausa.io/tesseract/cubes/{cube}", timeout=30) as resp:
            live = json.loads(resp.read().decode("utf-8"))
        live_levels = {
            lvl["name"]
            for dim in live["dimensions"] if dim["name"] != "Geography"
            for h in dim["hierarchies"] for lvl in h["levels"]}
        rec_levels = {
            lvl["name"]
            for dim in recorded[cube]["dimensions"] if dim["name"] != "Geography"
            for h in dim["hierarchies"] for lvl in h["levels"]}
        assert rec_levels <= live_levels, f"{cube}: recorded levels missing live"
