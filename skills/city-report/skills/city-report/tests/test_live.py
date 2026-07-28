"""Live contract tests against the real Data USA API.

Excluded from the default run (`-m live` to opt in) so CI needs no network, but
this is the suite that actually protects the manifest: two cubes have already
been retired or broken out from under it, and no offline test can see that
happen. Run it before a release, and when a report comes back with unexpected
gaps.
"""
from __future__ import annotations

import pytest

import bundle as bundle_mod
import datausa
import manifest

pytestmark = pytest.mark.live

#: A large city and a village of ~250 people. Both must work: the small one is
#: what catches a regression to the `_1` cubes, which cover only 675 places.
BIG = "Minneapolis, MN"
SMALL = "Hackensack, MN"


@pytest.fixture(scope="module")
def big_bundle():
    place = datausa.resolve_place(BIG)[0][0]
    return bundle_mod.build_bundle(place, datausa.fetch_place_data(place))


@pytest.fixture(scope="module")
def small_bundle():
    place = datausa.resolve_place(SMALL)[0][0]
    return bundle_mod.build_bundle(place, datausa.fetch_place_data(place))


def test_every_metric_returns_data_for_a_large_city(big_bundle):
    missing = [k for k, m in big_bundle["metrics"].items() if not m["available"]]
    assert not missing, f"no data for {missing} in {BIG}"


def test_every_metric_returns_data_for_a_tiny_town(small_bundle):
    """The `_5` cubes must cover a 250-person village, not just big cities."""
    missing = [k for k, m in small_bundle["metrics"].items() if not m["available"]]
    assert not missing, f"no data for {missing} in {SMALL}"


def test_headline_metrics_carry_both_benchmarks(big_bundle):
    for metric in manifest.headline_metrics():
        built = big_bundle["metrics"][metric.key]
        if not metric.benchmarkable:
            assert built["growth"], f"{metric.key} should carry growth"
            continue
        assert set(built["benchmarks"]) == {"State", "Nation"}, metric.key


def test_margins_of_error_are_actually_returned(big_bundle):
    """Catches the MOE-naming trap: a malformed name yields data and no margin.

    ``Average Commute Time`` is exempt — the Census publishes no margin for that
    derived measure, and the API returns an explicit null. ``median_home_value``
    is exempt because this skill interpolates it; inventing a margin for a
    figure the Census never published would be worse than stating none.
    """
    exempt = {"commute_time", "median_home_value"}
    for key, metric in big_bundle["metrics"].items():
        if key in exempt or not metric["available"]:
            continue
        if metric["kind"] == "breakdown":
            assert any(c["moe"] is not None for c in metric["categories"]), key
        else:
            assert metric["moe"] is not None, key


def test_small_town_estimates_are_flagged_as_wide(small_bundle):
    """A 250-person town's rates must not be presented as precise."""
    flagged = [k for k, m in small_bundle["metrics"].items() if m["wide_margin"]]
    assert flagged, "expected wide-margin flags on a village-sized place"


def test_population_matches_the_published_figure(big_bundle):
    """Ground truth: Minneapolis is a ~425k city, not 380k or 4M.

    Guards the Ethnicity trap — filtering to what looks like a total silently
    drops every Hispanic resident, about 10% of the city.
    """
    population = big_bundle["metrics"]["population"]["latest"]
    assert 400_000 < population < 460_000, population


def test_median_household_income_is_an_income_not_a_household_count():
    """Guards the headline trap.

    The wrong cube returns ~165,000 for Minneapolis — a count of households
    that reads exactly like a plausible median income.
    """
    income = None
    for metric in manifest.METRICS:
        if metric.key == "median_household_income":
            income = metric
    assert income.cube == "acs_ygr_median_household_income_race_5"


def test_median_household_income_value(big_bundle):
    value = big_bundle["metrics"]["median_household_income"]["latest"]
    assert 60_000 < value < 110_000, value


def test_dead_cubes_are_still_dead():
    """If Data USA ever fixes these, the manifest can be simplified.

    Until then this documents *why* population comes from the race cube and
    median home value is interpolated.
    """
    empty = datausa._fetch("data.jsonrecords", {
        "cube": "acs_yg_total_population_5", "drilldowns": "State",
        "measures": "Population", "limit": "1,0"})
    assert not empty["data"], "acs_yg_total_population_5 returns data again"

    with pytest.raises(datausa.DataUSAError):
        datausa._fetch("data.jsonrecords", {
            "cube": "acs_yg_housing_median_value_5", "drilldowns": "Place,Year",
            "measures": "Property Value", "limit": "1,0"})


def test_consolidated_city_names_still_resolve():
    """Eight places don't use the plain "City, ST" caption form."""
    for query, expected in [
        ("Indianapolis, IN", "Indianapolis city (balance), IN"),
        ("Louisville, KY", "Louisville/Jefferson County metro government (balance), KY"),
    ]:
        found, how = datausa.resolve_place(query)
        assert found and found[0].name == expected, (query, how, found)


def test_place_captions_are_unique():
    """What makes an exact-match lookup unambiguous."""
    captions = [p["caption"] for p in datausa.load_places()]
    assert len(captions) == len(set(captions))


def test_interpolated_median_tracks_the_published_one_year_value(big_bundle):
    """The 5-year median-value cube is broken, so the median is interpolated.

    Data USA's *1-year* cube does publish one for large cities. Comparing the
    two is the only available check that the interpolation is sound — they
    should agree within about 10%.
    """
    estimated = big_bundle["metrics"]["median_home_value"]["latest"]

    published = datausa._fetch("data.jsonrecords", {
        "cube": "acs_yg_housing_median_value_1", "drilldowns": "Year",
        "measures": "Property Value", "include": "Place:16000US2743000"})
    latest = max(published["data"], key=lambda r: r["Year"])["Property Value"]

    assert abs(estimated - latest) / latest < 0.10, (estimated, latest)


def test_a_full_load_is_fast():
    """A city load is one concurrent burst; if it ever serializes, this fails."""
    import time

    place = datausa.resolve_place(BIG)[0][0]
    start = time.time()
    datausa.fetch_place_data(place)
    assert time.time() - start < 15
