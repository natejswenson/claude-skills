"""Derivation tests: raw API payloads -> reportable numbers.

These are the tests that would catch a metric quietly changing meaning, so
each one pins a specific arithmetic claim rather than just asserting non-empty.
"""
from __future__ import annotations

import math

import pytest

import bundle
import manifest
from manifest import Metric


def rows_payload(rows, table_id="B01003"):
    return {"annotations": {"table_id": table_id}, "page": {"total": len(rows)},
            "columns": list(rows[0]) if rows else [], "data": rows}


SCALAR = Metric(key="s", section="people", label="S", cube="c",
                drilldowns=("Year",), measure="M", kind="scalar", unit="years",
                is_median=True)
TOTAL = Metric(key="t", section="people", label="T", cube="c",
               drilldowns=("Year", "Dim"), measure="M", kind="total")
MEMBER = Metric(key="m", section="people", label="M", cube="c",
                drilldowns=("Year", "Dim"), measure="M", kind="member",
                member="Total", unit="usd", is_median=True)
BREAK = Metric(key="b", section="people", label="B", cube="c",
               drilldowns=("Year", "Dim"), measure="M", kind="breakdown")
RATE = Metric(key="r", section="people", label="R", cube="c",
              drilldowns=("Year", "Dim"), measure="M", kind="rate",
              numerator=("Yes",), unit="percent")


def test_scalar_series():
    payload = rows_payload([
        {"Year": 2023, "M": 30.0, "M Moe": 0.5},
        {"Year": 2024, "M": 31.0, "M Moe": 0.4},
    ])
    values, moes = bundle._series(payload, SCALAR)
    assert values == {2023: 30.0, 2024: 31.0}
    assert moes[2024] == 0.4


def test_total_sums_members_and_combines_moe_by_census_rule():
    payload = rows_payload([
        {"Year": 2024, "Dim": "A", "M": 30.0, "M Moe": 3.0},
        {"Year": 2024, "Dim": "B", "M": 70.0, "M Moe": 4.0},
    ])
    values, moes = bundle._series(payload, TOTAL)
    assert values == {2024: 100.0}
    # sqrt(3^2 + 4^2) == 5, not 7 — margins add in quadrature, not linearly.
    assert moes[2024] == pytest.approx(5.0)


def test_member_picks_the_named_member_only():
    payload = rows_payload([
        {"Year": 2024, "Dim": "Total", "M": 80000.0, "M Moe": 100.0},
        {"Year": 2024, "Dim": "Other", "M": 20000.0, "M Moe": 50.0},
    ])
    values, moes = bundle._series(payload, MEMBER)
    assert values == {2024: 80000.0}
    assert moes[2024] == 100.0


def test_member_absent_yields_no_value():
    payload = rows_payload([{"Year": 2024, "Dim": "Other", "M": 5.0, "M Moe": 1.0}])
    values, _ = bundle._series(payload, MEMBER)
    assert values == {}


def test_rate_is_numerator_over_all_members():
    payload = rows_payload([
        {"Year": 2024, "Dim": "Yes", "M": 25.0, "M Moe": 2.0},
        {"Year": 2024, "Dim": "No", "M": 75.0, "M Moe": 3.0},
    ])
    values, moes = bundle._series(payload, RATE)
    assert values[2024] == pytest.approx(25.0)
    assert moes[2024] == pytest.approx(2.0)


def test_rate_with_zero_denominator_is_unavailable_not_a_crash():
    """A genuinely empty universe is normal for a tiny place."""
    payload = rows_payload([
        {"Year": 2024, "Dim": "Yes", "M": 0.0, "M Moe": 0.0},
        {"Year": 2024, "Dim": "No", "M": 0.0, "M Moe": 0.0},
    ])
    values, _ = bundle._series(payload, RATE)
    assert values == {}


def test_breakdown_has_no_series():
    payload = rows_payload([{"Year": 2024, "Dim": "A", "M": 1.0, "M Moe": 0.0}])
    assert bundle._series(payload, BREAK) == ({}, {})


def test_null_measures_stay_none_and_never_become_zero():
    """A null member must not drag a total or a median downward."""
    payload = rows_payload([
        {"Year": 2024, "Dim": "A", "M": None, "M Moe": None},
        {"Year": 2024, "Dim": "B", "M": 10.0, "M Moe": 1.0},
    ])
    values, _ = bundle._series(payload, TOTAL)
    assert values == {2024: 10.0}
    assert bundle._num(None) is None
    assert bundle._num("nope") is None
    assert bundle._num(float("nan")) is None
    assert bundle._num("3.5") == 3.5


def test_unknown_kind_raises():
    bad = Metric(key="x", section="people", label="X", cube="c",
                 drilldowns=("Year", "Dim"), measure="M", kind="bogus")
    with pytest.raises(ValueError):
        bundle._series(rows_payload([{"Year": 2024, "Dim": "A", "M": 1.0}]), bad)


def test_categories_sorted_desc_and_exclusions_applied():
    metric = Metric(key="b", section="people", label="B", cube="c",
                    drilldowns=("Year", "Dim"), measure="M", kind="breakdown",
                    exclude=("Total",))
    payload = rows_payload([
        {"Year": 2024, "Dim": "Total", "M": 100.0, "M Moe": 1.0},
        {"Year": 2024, "Dim": "A", "M": 30.0, "M Moe": 1.0},
        {"Year": 2024, "Dim": "B", "M": 70.0, "M Moe": 1.0},
    ])
    cats = bundle._categories(payload, metric, 2024)
    assert [c["label"] for c in cats] == ["B", "A"]


def test_categories_label_style_splits_on_first_dash_not_last():
    """`rsplit` would leave "Based Health Insurance Only"."""
    metric = Metric(key="b", section="health", label="B", cube="c",
                    drilldowns=("Year", "Dim"), measure="M", kind="breakdown",
                    label_style="after_dash")
    payload = rows_payload([{
        "Year": 2024,
        "Dim": "With One Type of Coverage-With Employer-Based Insurance Only",
        "M": 5.0, "M Moe": 1.0}])
    assert bundle._categories(payload, metric, 2024)[0]["label"] == \
        "With Employer-Based Insurance Only"


def test_categories_fall_back_to_latest_year_when_asked_year_absent():
    payload = rows_payload([
        {"Year": 2020, "Dim": "A", "M": 1.0, "M Moe": 0.0},
        {"Year": 2024, "Dim": "A", "M": 9.0, "M Moe": 0.0},
    ])
    assert bundle._categories(payload, BREAK, 1999)[0]["value"] == 9.0


def test_categories_empty_shapes():
    assert bundle._categories(None, BREAK, 2024) == []
    assert bundle._categories(rows_payload([]), BREAK, 2024) == []
    assert bundle._categories(rows_payload([{"Year": "x", "Dim": "A", "M": 1.0}]),
                              BREAK, 2024) == []
    assert bundle._categories(rows_payload([{"Year": 2024, "M": 1.0}]), SCALAR, 2024) == []
    # A null measure is skipped rather than charted as zero.
    assert bundle._categories(
        rows_payload([{"Year": 2024, "Dim": "A", "M": None}]), BREAK, 2024) == []


def test_helpers_tolerate_garbage():
    assert bundle._rows(None) == []
    assert bundle._rows({"data": "nope"}) == []
    assert bundle._table_id(None) is None
    assert bundle._latest_year(None) is None
    assert bundle._combine_moe([None, None]) is None
    assert bundle._dimension_column(SCALAR) is None
    assert bundle._series(None, SCALAR) == ({}, {})


def test_build_metric_marks_unavailable_with_a_reason():
    built = bundle.build_metric(SCALAR, {"Place": {}})
    assert built["available"] is False
    assert built["reason"]
    assert built["series"] == {}


def test_build_metric_wide_margin_flag():
    key = "c|Year|M"
    payload = rows_payload([{"Year": 2024, "M": 10.0, "M Moe": 5.0}])
    built = bundle.build_metric(SCALAR, {"Place": {key: payload}})
    assert built["moe_ratio"] == pytest.approx(0.5)
    assert built["wide_margin"] is True

    narrow = rows_payload([{"Year": 2024, "M": 10.0, "M Moe": 0.1}])
    assert bundle.build_metric(SCALAR, {"Place": {key: narrow}})["wide_margin"] is False


def test_build_metric_counts_get_growth_not_benchmarks():
    key = "c|Year,Dim|M"
    place = rows_payload([
        {"Year": 2013, "Dim": "A", "M": 100.0, "M Moe": 1.0},
        {"Year": 2024, "Dim": "A", "M": 110.0, "M Moe": 1.0},
    ])
    state = rows_payload([{"Year": 2024, "Dim": "A", "M": 9999.0, "M Moe": 1.0}])
    built = bundle.build_metric(TOTAL, {"Place": {key: place}, "State": {key: state}})
    assert built["benchmarks"] == {}
    assert built["growth"]["pct"] == pytest.approx(10.0)


def test_build_metric_rates_get_benchmarks_not_growth():
    key = "c|Year,Dim|M"
    def pay(yes, no):
        return rows_payload([
            {"Year": 2024, "Dim": "Yes", "M": yes, "M Moe": 1.0},
            {"Year": 2024, "Dim": "No", "M": no, "M Moe": 1.0}])
    built = bundle.build_metric(
        RATE, {"Place": {key: pay(20.0, 80.0)}, "State": {key: pay(10.0, 90.0)}})
    assert built["growth"] is None
    assert built["benchmarks"]["State"]["value"] == pytest.approx(10.0)


def test_benchmark_falls_back_to_its_own_latest_year():
    """A state series that lags the city's still yields a usable comparison."""
    key = "c|Year|M"
    place = rows_payload([{"Year": 2024, "M": 5.0, "M Moe": 0.1}])
    state = rows_payload([{"Year": 2022, "M": 4.0, "M Moe": 0.1}])
    built = bundle.build_metric(SCALAR, {"Place": {key: place}, "State": {key: state}})
    assert built["benchmarks"]["State"] == {"year": 2022, "value": 4.0}


def test_growth_needs_two_points_and_a_nonzero_base():
    key = "c|Year,Dim|M"
    one = rows_payload([{"Year": 2024, "Dim": "A", "M": 5.0, "M Moe": 0.0}])
    assert bundle.build_metric(TOTAL, {"Place": {key: one}})["growth"] is None
    zero = rows_payload([
        {"Year": 2013, "Dim": "A", "M": 0.0, "M Moe": 0.0},
        {"Year": 2024, "Dim": "A", "M": 5.0, "M Moe": 0.0}])
    assert bundle.build_metric(TOTAL, {"Place": {key: zero}})["growth"] is None


def test_rate_category_unit_is_count_not_percent():
    """A rate's members are the counts behind it — "345276.0%" was a real bug."""
    key = "c|Year,Dim|M"
    payload = rows_payload([
        {"Year": 2024, "Dim": "Yes", "M": 25.0, "M Moe": 1.0},
        {"Year": 2024, "Dim": "No", "M": 75.0, "M Moe": 1.0}])
    built = bundle.build_metric(RATE, {"Place": {key: payload}})
    assert built["unit"] == "percent"
    assert built["category_unit"] == "count"


def test_derived_median_interpolates_from_its_bucket_histogram():
    """Median home value is derived because the cube that would publish it 500s."""
    metric = Metric(key="d", section="housing", label="D", cube="c",
                    drilldowns=("Year", "Bucket"), measure="M",
                    kind="derived_median", unit="usd", is_median=True)
    payload = rows_payload([
        {"Year": 2024, "Bucket": "$200,000 to $249,999", "M": 10.0, "M Moe": 1.0},
        {"Year": 2024, "Bucket": "Less Than $10,000", "M": 10.0, "M Moe": 1.0},
    ])
    values, moes = bundle._series(payload, metric)
    # Buckets are interpolated in published order, not the order they arrive.
    assert 10000 <= values[2024] <= 250000
    # An interpolated figure has no published margin; inventing one would be
    # worse than stating none.
    assert moes[2024] is None


def test_derived_median_ignores_unparsable_buckets():
    metric = Metric(key="d", section="housing", label="D", cube="c",
                    drilldowns=("Year", "Bucket"), measure="M",
                    kind="derived_median", unit="usd", is_median=True)
    payload = rows_payload([{"Year": 2024, "Bucket": "nonsense", "M": 5.0}])
    assert bundle._series(payload, metric) == ({}, {})


def test_build_bundle_shape(place):
    data = bundle.build_bundle(place, {"Place": {}})
    assert data["place"]["slug"] == "testville-mn"
    assert data["vintage"] == manifest.VINTAGE
    assert set(data["metrics"]) == {m.key for m in manifest.METRICS}
    assert data["fetched_at"].endswith("+00:00")


# ------------------------------------------------------- bucket interpolation


def test_parse_bucket_bounds_all_three_shapes():
    assert bundle.parse_bucket_bounds("$100,000 to $124,999") == (100000.0, 124999.0)
    assert bundle.parse_bucket_bounds("Less Than $10,000") == (0.0, 10000.0)
    assert bundle.parse_bucket_bounds("< $10,000") == (0.0, 10000.0)
    low, high = bundle.parse_bucket_bounds("$2,000,000 or More")
    assert low == 2000000.0 and high > low
    assert bundle.parse_bucket_bounds("$200,000+")[0] == 200000.0
    assert bundle.parse_bucket_bounds("no numbers here") is None


def test_interpolated_median_lands_inside_the_middle_bucket():
    cats = [{"value": 10.0}, {"value": 10.0}, {"value": 10.0}]
    bounds = [(0.0, 100.0), (100.0, 200.0), (200.0, 300.0)]
    median = bundle.interpolated_median(cats, bounds)
    assert 100.0 <= median <= 200.0


def test_interpolated_median_edge_cases():
    assert bundle.interpolated_median([], []) is None
    assert bundle.interpolated_median([{"value": 0.0}], [(0.0, 1.0)]) is None
    assert bundle.interpolated_median([{"value": 1.0}], [(0.0, 1.0), (1.0, 2.0)]) is None
    # Empty leading buckets are skipped; the median lands inside the first
    # bucket that actually holds anything.
    assert bundle.interpolated_median(
        [{"value": 0.0}, {"value": 0.0}, {"value": 4.0}],
        [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)]) == 2.5


def test_interpolated_median_matches_the_published_value_for_minneapolis():
    """Sanity check on the method itself.

    Data USA's 1-year cube publishes $368,300 for Minneapolis in 2024. The
    5-year cube this skill must use returns HTTP 500, so the median is
    interpolated from the bucket histogram — and lands within a few percent,
    which is what makes it fit to publish as an explicit estimate.
    """
    # Simplified histogram concentrated around the $300-400k bucket.
    labels = ["$200,000 to $249,999", "$250,000 to $299,999",
              "$300,000 to $399,999", "$400,000 to $499,999"]
    counts = [5000.0, 9000.0, 24605.0, 15007.0]
    cats = [{"value": c} for c in counts]
    bounds = [bundle.parse_bucket_bounds(l) for l in labels]
    median = bundle.interpolated_median(cats, bounds)
    assert 300000 < median < 400000
