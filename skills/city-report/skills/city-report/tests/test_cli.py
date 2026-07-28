"""Report assembly and the three command-line entry points."""
from __future__ import annotations

import json
import os

import pytest

import bundle as bundle_mod
import datausa
import load as load_mod
import manifest
import query as query_mod
import report as report_mod


def full_payloads():
    """Synthetic payloads covering every manifest query, for all three geos."""
    out = {}
    for level in ("Place", "State", "Nation"):
        level_map = {}
        for cube, drilldowns, measure in manifest.unique_queries():
            moe = manifest.moe_name(measure)
            dim = next((d for d in drilldowns if d != "Year"), None)
            rows = []
            for year in (2013, 2024):
                if dim:
                    for i, member in enumerate(_members_for(cube, dim)):
                        rows.append({"Year": year, dim: member,
                                     measure: 100.0 * (i + 1) + year - 2013,
                                     moe: 5.0})
                else:
                    rows.append({"Year": year, measure: 20.0 + year - 2013, moe: 1.0})
            level_map[f"{cube}|{','.join(drilldowns)}|{measure}"] = {
                "annotations": {"table_id": "B00001"},
                "page": {"total": len(rows)},
                "columns": list(rows[0]),
                "data": rows,
            }
        out[level] = level_map
    return out


def _members_for(cube, dim):
    """Member captions a metric on this (cube, dim) will look for."""
    wanted = ["Alpha", "Beta"]
    for metric in manifest.METRICS:
        if metric.cube != cube or dim not in metric.drilldowns:
            continue
        if metric.member:
            wanted.append(metric.member)
        wanted.extend(metric.numerator)
    if dim in ("Household Income Bucket", "Value Bucket"):
        return ["Less Than $10,000", "$100,000 to $124,999", "$2,000,000 or More"]
    return list(dict.fromkeys(wanted))


@pytest.fixture
def loaded(tmp_cache, place):
    data = bundle_mod.build_bundle(place, full_payloads())
    datausa.write_cache(f"bundle-{place.slug}.json", data)
    return data


# ------------------------------------------------------------------- report


def test_build_html_is_self_contained_and_well_formed(loaded):
    html = report_mod.build_html(loaded)
    assert html.startswith("<!doctype html>")
    assert "<style>" in html and "</html>" in html
    # Nothing may be fetched at view time.
    assert "http://" not in html.replace("http://www.w3.org", "")
    assert "<svg" in html
    assert "Testville, MN" in html


def test_build_html_includes_provenance(loaded):
    html = report_mod.build_html(loaded)
    assert "ACS 5-year estimate" in html
    assert "B00001" in html          # census table id
    assert "Minnesota" in html       # benchmark rail named


def test_section_filter_emits_only_that_section(loaded):
    html = report_mod.build_html(loaded, sections=["housing"])
    assert "HOUSING REPORT" in html
    assert "<h2>Housing</h2>" in html
    assert "<h2>People</h2>" not in html


def test_every_chart_has_a_table_view(loaded):
    """No value may be reachable only by hovering a mark."""
    html = report_mod.build_html(loaded)
    assert html.count("<details class=\"table-view\">") >= html.count("<svg") - 2


def test_unavailable_metric_is_stated_not_omitted(place):
    data = bundle_mod.build_bundle(place, {"Place": {}})
    html = report_mod.build_html(data)
    assert "not published for this place" in html


def test_wide_margin_is_called_out(place):
    payloads = full_payloads()
    key = ("acs_ygs_median_age_total_5|Year,Gender|Median Age")
    payloads["Place"][key]["data"] = [
        {"Year": 2024, "Gender": "Total", "Median Age": 10.0, "Median Age Moe": 9.0}]
    data = bundle_mod.build_bundle(place, payloads)
    assert "Wide margin of error" in report_mod.build_html(data)


def test_standfirst_falls_back_when_nothing_loaded(place):
    data = bundle_mod.build_bundle(place, {"Place": {}})
    assert "American Community Survey" in report_mod._standfirst(data)


def test_pack_columns_balances_a_lopsided_section():
    """The Work & Commute void: a 4/11/4 section must not leave a column empty."""
    left, right = report_mod._pack_columns([(4, "a"), (11, "b"), (4, "c")])
    assert left == ["a", "c"] and right == ["b"]


def test_pack_columns_empty():
    assert report_mod._pack_columns([]) == ([], [])


def test_estimated_units_ranks_blocks_sensibly(loaded):
    metrics = loaded["metrics"]
    assert (report_mod._estimated_units(metrics["commute_means"])
            > report_mod._estimated_units(metrics["commute_time"]))
    assert report_mod._estimated_units(
        {"available": False, "key": "x", "kind": "scalar", "categories": []}) == 1


def test_distribution_block_captions_the_interpolated_median(loaded):
    html = report_mod._distribution_block(
        loaded["metrics"]["home_value_distribution"], report_mod.brand.load_theme())
    assert "interpolated" in html


def test_distribution_block_with_no_parsable_buckets():
    metric = {"categories": [{"label": "no numbers", "value": 5.0, "moe": None}],
              "latest_year": 2024, "unit": "count", "key": "home_value_distribution"}
    html = report_mod._distribution_block(metric, report_mod.brand.load_theme())
    assert "interpolated" not in html
    assert report_mod._distribution_block(
        {"categories": []}, report_mod.brand.load_theme()) == ""


def test_write_report_and_open(loaded, tmp_path, monkeypatch):
    opened = []
    monkeypatch.setattr(report_mod.subprocess, "run", lambda *a, **k: opened.append(a))
    monkeypatch.setattr(report_mod.webbrowser, "open", lambda u: opened.append(u))
    path = report_mod.write_report(loaded, str(tmp_path))
    assert os.path.exists(path)
    report_mod.open_in_browser(path)
    assert opened


def test_open_in_browser_survives_a_failing_opener(monkeypatch, tmp_path):
    monkeypatch.setattr(report_mod.sys, "platform", "linux")
    monkeypatch.setattr(report_mod.webbrowser, "open",
                        lambda u: (_ for _ in ()).throw(OSError("no display")))
    report_mod.open_in_browser(str(tmp_path / "x.html"))  # must not raise


def test_load_bundle_missing_slug_is_actionable(tmp_cache):
    with pytest.raises(SystemExit, match="load.py"):
        report_mod.load_bundle("nowhere-zz")


def test_report_cli(loaded, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    assert report_mod.main([loaded["place"]["slug"], "--out", str(tmp_path)]) == 0
    assert "Report written" in capsys.readouterr().out


def test_report_cli_no_open(loaded, tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: calls.append(p))
    report_mod.main([loaded["place"]["slug"], "--out", str(tmp_path), "--no-open"])
    assert calls == []


# --------------------------------------------------------------------- load


def test_digest_leads_with_headline_and_tells_you_the_next_command(loaded):
    text = load_mod.digest(loaded)
    assert "HEADLINE" in text
    assert "Testville, MN" in text
    # The follow-on command uses the place name, not the internal slug — the
    # user never has to learn that slugs exist.
    assert 'report.py "Testville, MN"' in text
    for _, title in manifest.SECTIONS:
        assert title.upper() in text


def test_digest_marks_wide_margin_figures(place):
    payloads = full_payloads()
    key = "acs_ygs_median_age_total_5|Year,Gender|Median Age"
    payloads["Place"][key]["data"] = [
        {"Year": 2024, "Gender": "Total", "Median Age": 10.0, "Median Age Moe": 9.0}]
    text = load_mod.digest(bundle_mod.build_bundle(place, payloads))
    # The magnitude is shown, not a binary flag: across two neighbouring towns
    # this skill reported the same 4.6% poverty rate at +-70% and +-171%.
    assert "[\u00b190%]" in text


def test_digest_reports_unavailable_metrics(place):
    text = load_mod.digest(bundle_mod.build_bundle(place, {"Place": {}}))
    assert "unavailable" in text
    assert "Loaded 0/" in text


def test_load_cli_fetches_then_serves_from_cache(tmp_cache, place, monkeypatch, capsys):
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: ([place], "exact"))
    calls = []

    def fetch(p, include_benchmarks=True):
        calls.append(p)
        return full_payloads()

    monkeypatch.setattr(load_mod.datausa, "fetch_place_data", fetch)
    assert load_mod.main(["Testville, MN"]) == 0
    assert "fetched" in capsys.readouterr().out
    assert load_mod.main(["Testville, MN"]) == 0
    assert "cached" in capsys.readouterr().out
    assert len(calls) == 1


def test_load_cli_refresh_bypasses_cache(tmp_cache, place, monkeypatch, capsys):
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: ([place], "exact"))
    monkeypatch.setattr(load_mod.datausa, "fetch_place_data",
                        lambda p, include_benchmarks=True: full_payloads())
    load_mod.main(["Testville, MN"])
    capsys.readouterr()
    load_mod.main(["Testville, MN", "--refresh"])
    assert "fetched" in capsys.readouterr().out


def test_load_cli_ambiguous_exits_2_without_fetching(place, monkeypatch, capsys):
    other = datausa.Place("Testville, KS", "16000US2099999", "Kansas",
                          "04000US20", "testville-ks")
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: ([place, other], "fuzzy"))
    monkeypatch.setattr(load_mod.datausa, "fetch_place_data",
                        lambda *a, **k: pytest.fail("must not fetch"))
    assert load_mod.main(["Testville"]) == 2
    out = capsys.readouterr().out
    assert "2 places match" in out and "Testville, KS" in out


def test_load_cli_list_flag_on_single_match(tmp_cache, place, monkeypatch, capsys):
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: ([place], "exact"))
    assert load_mod.main(["Testville, MN", "--list"]) == 0
    assert "16000US2799999" in capsys.readouterr().out


def test_load_cli_no_match_exits_1(monkeypatch, capsys):
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: ([], "none"))
    assert load_mod.main(["Nowhere, ZZ"]) == 1
    assert "No Census place" in capsys.readouterr().err


def test_load_cli_announces_a_non_exact_match(tmp_cache, place, monkeypatch, capsys):
    """A fuzzy hit must never be passed off as a lookup."""
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: ([place], "prefix"))
    monkeypatch.setattr(load_mod.datausa, "fetch_place_data",
                        lambda p, include_benchmarks=True: full_payloads())
    load_mod.main(["Testville, IN"])
    assert "prefix match" in capsys.readouterr().out


# -------------------------------------------------------------------- query


def test_query_lists_metrics(loaded, capsys):
    assert query_mod.main([loaded["place"]["slug"]]) == 0
    out = capsys.readouterr().out
    assert "population" in out and "PEOPLE" in out


def test_query_describes_a_rate_with_benchmarks(loaded, capsys):
    query_mod.main([loaded["place"]["slug"], "poverty_rate"])
    out = capsys.readouterr().out
    assert "value" in out and "vs state" in out


def test_query_describes_a_count_with_growth(loaded, capsys):
    query_mod.main([loaded["place"]["slug"], "population"])
    assert "change" in capsys.readouterr().out


def test_query_top_and_series_flags(loaded, capsys):
    query_mod.main([loaded["place"]["slug"], "race", "--top", "1"])
    assert "more" in capsys.readouterr().out
    query_mod.main([loaded["place"]["slug"], "median_household_income", "--series"])
    assert "2013" in capsys.readouterr().out


def test_query_json_flag(loaded, capsys):
    query_mod.main([loaded["place"]["slug"], "population", "--json"])
    assert json.loads(capsys.readouterr().out)["key"] == "population"


def test_query_unknown_metric_exits_1_and_lists_keys(loaded, capsys):
    assert query_mod.main([loaded["place"]["slug"], "bogus"]) == 1
    assert "Unknown metric" in capsys.readouterr().err


def test_query_unavailable_metric(place, tmp_cache, capsys):
    data = bundle_mod.build_bundle(place, {"Place": {}})
    datausa.write_cache(f"bundle-{place.slug}.json", data)
    query_mod.main([place.slug, "population"])
    assert "not published" in capsys.readouterr().out


def test_query_warns_on_a_wide_margin(place, tmp_cache, capsys):
    payloads = full_payloads()
    key = "acs_ygs_median_age_total_5|Year,Gender|Median Age"
    payloads["Place"][key]["data"] = [
        {"Year": 2024, "Gender": "Total", "Median Age": 10.0, "Median Age Moe": 9.0}]
    datausa.write_cache(f"bundle-{place.slug}.json",
                        bundle_mod.build_bundle(place, payloads))
    query_mod.main([place.slug, "median_age"])
    assert "WARNING" in capsys.readouterr().out


def test_query_prints_a_note_when_one_exists(loaded, capsys):
    query_mod.main([loaded["place"]["slug"], "population"])
    assert "note:" in capsys.readouterr().out


def test_query_lists_an_unavailable_scalar_metric(place, tmp_cache, capsys):
    data = bundle_mod.build_bundle(place, {"Place": {}})
    datausa.write_cache(f"bundle-{place.slug}.json", data)
    query_mod.main([place.slug])
    assert "unavailable" in capsys.readouterr().out


# --------------------------------------- partial bundles (forward-compat)
#
# A bundle cached by an older version of the skill can be missing metric keys
# the current manifest knows about. Every consumer must skip those rather than
# raising a KeyError on data the user cannot regenerate without a refetch.


def _bundle_without(data, *keys):
    trimmed = json.loads(json.dumps(data))
    for key in keys:
        trimmed["metrics"].pop(key, None)
    return trimmed


def test_digest_skips_metrics_absent_from_an_older_bundle(loaded):
    trimmed = _bundle_without(loaded, "population", "median_age")
    text = load_mod.digest(trimmed)
    assert "Median household income" in text
    assert "Median age" not in text


def test_query_list_skips_absent_metrics(loaded, tmp_cache, capsys):
    trimmed = _bundle_without(loaded, "population")
    datausa.write_cache(f"bundle-{trimmed['place']['slug']}.json", trimmed)
    query_mod.main([trimmed["place"]["slug"]])
    out = capsys.readouterr().out
    assert "median_age" in out
    assert "\n  population " not in out


def test_report_omits_a_section_with_no_metrics(loaded):
    health_keys = [m.key for m in manifest.metrics_for_section("health")]
    trimmed = _bundle_without(loaded, *health_keys)
    html = report_mod.build_html(trimmed)
    assert "<h2>Health</h2>" not in html
    assert "<h2>People</h2>" in html


def test_table_view_is_empty_when_there_are_no_rows():
    assert report_mod._table_view(["A"], []) == ""


# ------------------------------------------------------------------- UX
#
# The city argument is optional and accepts a slug OR a place name, so nobody
# has to retype an internal slug to see data they just loaded.


def _cache_second_city(name="Otherville, KS", slug="otherville-ks"):
    other = datausa.Place(name, "16000US2099999", "Kansas", "04000US20", slug)
    datausa.write_cache(f"bundle-{slug}.json",
                        bundle_mod.build_bundle(other, full_payloads()))
    return other


def test_list_cached_reports_slug_and_name(loaded):
    _cache_second_city()
    cached = dict(datausa.list_cached())
    assert cached["testville-mn"] == "Testville, MN"
    assert cached["otherville-ks"] == "Otherville, KS"


def test_list_cached_skips_unreadable_files(loaded, tmp_cache):
    (tmp_cache / "bundle-broken.json").write_text("{not json", encoding="utf-8")
    (tmp_cache / "unrelated.txt").write_text("x", encoding="utf-8")
    assert "broken" not in dict(datausa.list_cached())


def test_resolve_slug_defaults_to_the_only_loaded_city(loaded):
    assert datausa.resolve_cached_slug(None) == ("testville-mn", "")


def test_resolve_slug_accepts_a_place_name_or_a_slug(loaded):
    assert datausa.resolve_cached_slug("Testville, MN")[0] == "testville-mn"
    assert datausa.resolve_cached_slug("testville-mn")[0] == "testville-mn"
    # Case-insensitive, and a name that was never slugified still resolves.
    assert datausa.resolve_cached_slug("testville, mn")[0] == "testville-mn"
    # Punctuation the user didn't type: "Testville MN" slugifies onto the slug.
    assert datausa.resolve_cached_slug("Testville MN")[0] == "testville-mn"


def test_resolve_slug_asks_when_several_are_loaded(loaded):
    _cache_second_city()
    slug, message = datausa.resolve_cached_slug(None)
    assert slug is None
    assert "2 cities are loaded" in message
    assert "Otherville, KS" in message


def test_resolve_slug_unknown_city_lists_what_is_loaded(loaded):
    slug, message = datausa.resolve_cached_slug("Nowhere, ZZ")
    assert slug is None
    assert "is not loaded" in message and "testville-mn" in message


def test_resolve_slug_with_empty_cache(tmp_cache):
    slug, message = datausa.resolve_cached_slug(None)
    assert slug is None and "No city loaded yet" in message


def test_report_cli_needs_no_city_when_only_one_is_loaded(loaded, tmp_path, monkeypatch):
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    assert report_mod.main(["--out", str(tmp_path)]) == 0


def test_report_cli_accepts_a_place_name(loaded, tmp_path, monkeypatch):
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    assert report_mod.main(["Testville, MN", "--out", str(tmp_path)]) == 0


def test_report_cli_errors_helpfully_on_an_unloaded_city(loaded, tmp_path, capsys):
    assert report_mod.main(["Nowhere, ZZ", "--out", str(tmp_path)]) == 1
    assert "is not loaded" in capsys.readouterr().err


def test_section_aliases_map_to_manifest_keys():
    assert report_mod.normalize_section("commute") == "work"
    assert report_mod.normalize_section("Demographics") == "people"
    assert report_mod.normalize_section("cost of living") == "economy"
    assert report_mod.normalize_section("housing") == "housing"
    with pytest.raises(Exception):
        report_mod.normalize_section("bogus")


def test_multi_section_report_names_every_section_consistently(loaded, tmp_path, monkeypatch):
    """The masthead used to name whichever section sorted first.

    A file called "…-housing.html" whose masthead read "ECONOMY REPORT" is
    worse than no section filter at all.
    """
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    report_mod.main(["--out", str(tmp_path), "--section", "commute",
                     "--section", "economy"])
    written = list(tmp_path.glob("*.html"))[0]
    assert "economy-work" in written.name
    html = written.read_text(encoding="utf-8")
    assert "ECONOMY · WORK &amp; COMMUTE" in html


def test_repeated_section_flag_is_deduplicated(loaded, tmp_path, monkeypatch):
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    report_mod.main(["--out", str(tmp_path), "--section", "housing",
                     "--section", "homes"])
    written = list(tmp_path.glob("*.html"))[0]
    assert written.name.count("housing") == 1


def test_query_cli_needs_no_city_when_only_one_is_loaded(loaded, capsys):
    assert query_mod.main([]) == 0
    assert "PEOPLE" in capsys.readouterr().out


def test_query_cli_treats_a_lone_metric_key_as_a_metric(loaded, capsys):
    """`query.py poverty_rate` must not be read as a city name."""
    assert query_mod.main(["poverty_rate"]) == 0
    assert "Poverty rate" in capsys.readouterr().out


def test_query_cli_cities_flag(loaded, capsys):
    assert query_mod.main(["--cities"]) == 0
    assert "Testville, MN" in capsys.readouterr().out


def test_query_cli_cities_flag_with_empty_cache(tmp_cache, capsys):
    assert query_mod.main(["--cities"]) == 0
    assert "No city loaded yet" in capsys.readouterr().out


def test_query_cli_errors_on_an_unloaded_city(loaded, capsys):
    assert query_mod.main(["Nowhere, ZZ", "population"]) == 1
    assert "is not loaded" in capsys.readouterr().err


def test_load_cli_caps_a_huge_ambiguous_list(monkeypatch, capsys):
    """A bare "Springfield" matches dozens; printing all of them buries the ask."""
    many = [datausa.Place(f"Springfield, S{i}", f"16000US{i:07d}", "S", "04000US01",
                          f"springfield-s{i}") for i in range(30)]
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: (many, "fuzzy"))
    assert load_mod.main(["Springfield"]) == 2
    out = capsys.readouterr().out
    assert "and 18 more" in out
    assert out.count("Springfield, S") == 12


# --------------------------------------------------------- comparison mode


@pytest.fixture
def two_cities(loaded, tmp_cache):
    """A second city whose values differ from the first, for comparisons."""
    other = datausa.Place("Otherville, KS", "16000US2099999", "Kansas",
                          "04000US20", "otherville-ks")
    payloads = full_payloads()
    for level in payloads:
        for payload in payloads[level].values():
            for row in payload["data"]:
                for key in row:
                    if isinstance(row[key], float):
                        row[key] = row[key] * 3
    data = bundle_mod.build_bundle(other, payloads)
    datausa.write_cache("bundle-otherville-ks.json", data)
    return loaded, data


def test_index_to_base_rebases_to_100():
    assert report_mod._index_to_base({"2013": 50.0, "2024": 75.0}) == {
        "2013": 100.0, "2024": 150.0}
    assert report_mod._index_to_base({}) == {}
    assert report_mod._index_to_base({"2013": 0.0, "2024": 5.0}) == {}


def test_share_pct_keeps_a_decimal_for_small_values():
    """A visible bar labelled "0%" reads as a rendering bug."""
    assert report_mod._share_pct(93.0) == "93%"
    assert report_mod._share_pct(0.4) == "0.4%"
    assert report_mod._share_pct(9.9) == "9.9%"


def test_shares_normalise_a_breakdown_to_its_own_total(two_cities):
    data_a, _ = two_cities
    shares = report_mod._shares(data_a["metrics"]["race"], 99)
    assert abs(sum(s["share"] for s in shares) - 100) < 0.001


def test_shares_of_an_empty_breakdown():
    assert report_mod._shares({"categories": []}, 5) == []
    assert report_mod._shares({"categories": [{"label": "a", "value": 0.0}]}, 5) == []


def test_paired_rows_union_both_cities_categories(two_cities):
    data_a, data_b = two_cities
    rows = report_mod._paired_rows(data_a["metrics"]["race"],
                                   data_b["metrics"]["race"], 6)
    assert rows and all({"label", "a", "b"} <= set(r) for r in rows)
    # Sorted by the larger of the two shares, so a category that only one city
    # is distinctive for still surfaces.
    assert rows[0]["a"] >= rows[-1]["a"] or rows[0]["b"] >= rows[-1]["b"]


def test_comparison_html_puts_both_cities_on_one_document(two_cities):
    data_a, data_b = two_cities
    html = report_mod.build_comparison_html(data_a, data_b)
    assert "CITY COMPARISON" in html
    assert "Testville, MN" in html and "Otherville, KS" in html
    assert 'class="versus"' in html
    assert html.count('class="legend"') >= 5   # every two-series chart


def test_comparison_normalises_breakdowns_and_says_so(two_cities):
    data_a, data_b = two_cities
    html = report_mod.build_comparison_html(data_a, data_b)
    assert "share of each city" in html and "composition rather than size" in html


def test_comparison_indexes_counts_rather_than_sharing_a_linear_axis(two_cities):
    """2,178 and 131,627 on one axis renders both as flat lines."""
    data_a, data_b = two_cities
    html = report_mod.build_comparison_html(data_a, data_b)
    assert "Indexed to each city" in html


def test_comparison_section_filter(two_cities):
    data_a, data_b = two_cities
    html = report_mod.build_comparison_html(data_a, data_b, sections=["housing"])
    assert "<h2>Housing</h2>" in html
    assert "<h2>People</h2>" not in html


def test_comparison_states_when_a_metric_is_missing_for_one_city(loaded, place):
    absent = bundle_mod.build_bundle(place, {"Place": {}})
    html = report_mod.build_comparison_html(loaded, absent)
    assert "not published for" in html


def test_comparison_section_with_no_shared_metrics(loaded):
    trimmed = _bundle_without(loaded, *[m.key for m in manifest.METRICS])
    html = report_mod.build_comparison_html(loaded, trimmed)
    assert "<h2>People</h2>" not in html


def test_compare_delta_needs_both_sides(loaded):
    metric = loaded["metrics"]["median_age"]
    assert report_mod._compare_delta(metric, {"available": False}) == ""


def test_compare_stat_tile_flags_a_wide_margin_by_city(place, tmp_cache):
    payloads = full_payloads()
    key = "acs_ygs_median_age_total_5|Year,Gender|Median Age"
    payloads["Place"][key]["data"] = [
        {"Year": 2024, "Gender": "Total", "Median Age": 10.0, "Median Age Moe": 9.0}]
    noisy = bundle_mod.build_bundle(place, payloads)
    clean = bundle_mod.build_bundle(place, full_payloads())
    tile = report_mod._compare_stat_tile(
        noisy["metrics"]["median_age"], clean["metrics"]["median_age"], "A", "B")
    assert "wide margin: A" in tile
    tile_b = report_mod._compare_stat_tile(
        clean["metrics"]["median_age"], noisy["metrics"]["median_age"], "A", "B")
    assert "wide margin: B" in tile_b


def test_report_cli_vs_writes_a_comparison(two_cities, tmp_path, monkeypatch):
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    assert report_mod.main(["Testville, MN", "--vs", "Otherville, KS",
                            "--out", str(tmp_path)]) == 0
    written = list(tmp_path.glob("*.html"))[0]
    assert written.name.startswith("testville-mn-vs-otherville-ks-")
    assert "CITY COMPARISON" in written.read_text(encoding="utf-8")


def test_report_cli_vs_with_sections_names_them_in_the_filename(two_cities, tmp_path,
                                                                monkeypatch):
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    report_mod.main(["Testville, MN", "--vs", "Otherville, KS", "--section",
                     "housing", "--out", str(tmp_path)])
    assert "vs-otherville-ks-housing" in list(tmp_path.glob("*.html"))[0].name


def test_report_cli_vs_unknown_city(two_cities, tmp_path, capsys):
    assert report_mod.main(["Testville, MN", "--vs", "Nowhere, ZZ",
                            "--out", str(tmp_path)]) == 1
    assert "is not loaded" in capsys.readouterr().err


def test_report_cli_vs_itself_is_refused(loaded, tmp_path, capsys):
    assert report_mod.main(["Testville, MN", "--vs", "testville-mn",
                            "--out", str(tmp_path)]) == 1
    assert "same" in capsys.readouterr().err


def test_load_cli_list_flag_shows_all_of_them(monkeypatch, capsys):
    many = [datausa.Place(f"Springfield, S{i}", f"16000US{i:07d}", "S", "04000US01",
                          f"springfield-s{i}") for i in range(30)]
    monkeypatch.setattr(load_mod.datausa, "resolve_place",
                        lambda q, refresh=False: (many, "fuzzy"))
    load_mod.main(["Springfield", "--list"])
    assert "more" not in capsys.readouterr().out


# ------------------------------------------- improvements from real runs
#
# Each of these came from watching the skill answer real questions, not from
# reading the code.


def test_median_home_value_is_a_first_class_metric(loaded):
    """It was computed at render time only, so it never reached the digest —
    and "what's the median home value" is a top-three question for any city."""
    metric = loaded["metrics"]["median_home_value"]
    assert metric["headline"] is True
    assert metric["available"]
    assert metric["latest"] > 0
    # Benchmarked, because the same interpolation runs on the state and
    # national bucket payloads.
    assert set(metric["benchmarks"]) == {"State", "Nation"}
    assert "Median home value" in load_mod.digest(loaded)


def test_median_home_value_carries_no_duplicate_buckets(loaded):
    """The distribution metric owns the histogram; duplicating it here also
    labelled household counts with the median's dollar unit."""
    assert loaded["metrics"]["median_home_value"]["categories"] == []
    assert loaded["metrics"]["home_value_distribution"]["categories"]


def test_median_home_value_costs_no_extra_query():
    """It shares a cube+drilldowns+measure with the distribution metric."""
    triples = manifest.unique_queries()
    housing = [t for t in triples if t[0] == "acs_ygo_housing_value_bucket_5"]
    assert len(housing) == 1


def test_report_reads_the_derived_median_rather_than_recomputing(loaded):
    """One source of truth, so the report and the digest cannot drift."""
    median = loaded["metrics"]["median_home_value"]["latest"]
    assert report_mod._median_for(
        loaded["metrics"]["home_value_distribution"], loaded["metrics"]) == median
    assert report_mod._median_for(
        loaded["metrics"]["income_distribution"], loaded["metrics"]) is None


def test_digest_shows_margin_magnitude_not_a_binary_flag(place):
    """Two neighbouring towns reported the same 4.6% poverty rate — one at
    +-70%, the other +-171%. A shared flag made them look equally solid."""
    payloads = full_payloads()
    key = "acs_ygs_median_age_total_5|Year,Gender|Median Age"
    payloads["Place"][key]["data"] = [
        {"Year": 2024, "Gender": "Total", "Median Age": 10.0, "Median Age Moe": 17.0}]
    text = load_mod.digest(bundle_mod.build_bundle(place, payloads))
    assert "[±170%]" in text
    assert "[wide margin]" not in text


def test_margin_note_is_silent_below_the_threshold():
    import fmt
    assert fmt.margin_note({"wide_margin": False}) == ""
    assert fmt.margin_note({"wide_margin": True, "moe_ratio": 0.7}) == "  [±70%]"


def test_report_vs_autoloads_a_city_that_is_not_cached(loaded, tmp_path, monkeypatch):
    """Every comparison run so far needed a separate load.py call first."""
    other = datausa.Place("Autoville, KS", "16000US2011111", "Kansas",
                          "04000US20", "autoville-ks")
    monkeypatch.setattr(report_mod, "open_in_browser", lambda p: None)
    monkeypatch.setattr(datausa, "resolve_place",
                        lambda q, refresh=False: ([other], "exact"))
    monkeypatch.setattr(datausa, "fetch_place_data",
                        lambda p, include_benchmarks=True: full_payloads())
    assert report_mod.main(["Testville, MN", "--vs", "Autoville, KS",
                            "--out", str(tmp_path)]) == 0
    assert datausa.read_cache("bundle-autoville-ks.json", 10_000) is not None


def test_report_vs_autoload_still_refuses_an_ambiguous_name(loaded, tmp_path,
                                                            monkeypatch, capsys):
    many = [datausa.Place(f"Springfield, S{i}", f"16000US{i:07d}", "S",
                          "04000US01", f"springfield-s{i}") for i in range(3)]
    monkeypatch.setattr(datausa, "resolve_place",
                        lambda q, refresh=False: (many, "fuzzy"))
    assert report_mod.main(["Testville, MN", "--vs", "Springfield",
                            "--out", str(tmp_path)]) == 1
    assert "is not loaded" in capsys.readouterr().err


def test_index_caption_names_a_shared_base_year_only_when_it_is_shared(loaded,
                                                                       place,
                                                                       tmp_cache):
    """Naming one year misdescribes the other line when the series differ."""
    shifted = json.loads(json.dumps(loaded))
    pop = shifted["metrics"]["population"]
    pop["series"] = {"2017": 100.0, "2024": 130.0}
    shifted["place"]["name"] = "Shifted, KS"
    html = report_mod.build_comparison_html(loaded, shifted, sections=["people"])
    assert "first published year" in html

    same = json.loads(json.dumps(loaded))
    same["place"]["name"] = "Same, KS"
    html_same = report_mod.build_comparison_html(loaded, same, sections=["people"])
    assert "own 2013 level" in html_same
