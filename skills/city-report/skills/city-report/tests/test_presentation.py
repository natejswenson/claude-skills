"""Formatting, brand theme, and SVG chart primitives."""
from __future__ import annotations

import json
import re

import pytest

import brand
import charts
import fmt

THEME = brand.DEFAULT_THEME


# ------------------------------------------------------------------ fmt


def test_format_value_per_unit():
    assert fmt.format_value(80846, "usd") == "$80,846"
    assert fmt.format_value(47.66, "percent") == "47.7%"
    assert fmt.format_value(0.4951, "ratio") == "0.495"
    assert fmt.format_value(33.4, "years") == "33.4 yrs"
    assert fmt.format_value(22.0, "minutes") == "22.0 min"
    assert fmt.format_value(427246, "count") == "427,246"
    assert fmt.format_value(None, "usd") == "—"


def test_format_compact_only_shortens_counts_and_dollars():
    assert fmt.format_compact(427246, "count") == "427K"
    assert fmt.format_compact(2_500_000, "count") == "2.5M"
    assert fmt.format_compact(1234, "count") == "1,234"
    # Under 100K stays exact — "$81K" in a masthead loses real precision.
    assert fmt.format_compact(80846, "usd") == "$80,846"
    assert fmt.format_compact(180846, "usd") == "$181K"
    # A median age must not be rounded to a bare integer.
    assert fmt.format_compact(33.4, "years") == "33.4 yrs"
    assert fmt.format_compact(5.6, "percent") == "5.6%"
    assert fmt.format_compact(None) == "—"


def test_format_moe():
    assert fmt.format_moe(1824, "usd") == "± 1,824"
    assert fmt.format_moe(None, "usd") == ""


def test_compare_uses_points_for_rates_and_percent_for_levels():
    assert fmt.compare(16.0, 9.3, "percent") == "+6.7% pts"
    assert fmt.compare(9.3, 16.0, "percent") == "−6.7% pts"
    assert fmt.compare(80846, 89000, "usd") == "−9%"
    assert fmt.compare(100, 100, "usd") == "on par"
    assert fmt.compare(None, 5, "usd") == "—"
    assert fmt.compare(5, 0, "usd") == "—"
    assert fmt.compare(0.5, 0.4, "ratio") == "+0.1 pts"


def test_count_comparisons_read_as_size_ratios():
    """"Hawley is −98% vs Fargo" is right and unreadable; "1/60 the size" isn't."""
    assert fmt.compare(2178, 600, "count") == "3.6× larger"
    assert fmt.compare(2178, 131627, "count") == "1/60 the size"
    assert fmt.compare(2178, 1352, "count") == "1.6× larger"
    assert fmt.compare(600, 2178, "count") == "3.6× smaller"
    assert fmt.compare(2178, 2178, "count") == "about the same size"
    assert fmt.compare(50000, 1000, "count") == "50× larger"
    # Degenerate inputs must not raise on the way to a report.
    assert fmt.compare(0, 100, "count") == "—"
    assert fmt._size_ratio(5, 0) == "—"


def test_context_bits_benchmarks_vs_growth():
    rate = {"latest": 16.0, "unit": "percent",
            "benchmarks": {"State": {"value": 9.3}, "Nation": {"value": 12.5}},
            "growth": None}
    assert fmt.context_bits(rate) == ["+6.7% pts vs state", "+3.5% pts vs US"]

    count = {"latest": 427246, "unit": "count", "benchmarks": {},
             "growth": {"pct": 10.4, "from_year": 2013, "to_year": 2024}}
    assert fmt.context_bits(count) == ["+10% since 2013"]

    negative = {"latest": 1, "unit": "count", "benchmarks": {},
                "growth": {"pct": -3.0, "from_year": 2013, "to_year": 2024}}
    assert fmt.context_bits(negative) == ["−3% since 2013"]
    assert fmt.context_bits({"latest": 1, "unit": "count"}) == []


# ---------------------------------------------------------------- brand


def test_default_theme_is_press():
    assert THEME["colors"]["paper"] == "#F5F0E6"
    assert THEME["colors"]["accent"] == "#E8501F"


def test_stylesheet_has_no_rounded_corners_shadows_or_gradients():
    """PRESS forbids all three; this is the brand, not an oversight."""
    css = brand.stylesheet(THEME)
    assert "border-radius" not in css
    assert "box-shadow" not in css
    assert "gradient" not in css
    assert THEME["colors"]["paper"] in css


def test_fill_steps_are_capped_at_three():
    """Lighter extensions of the ink ramp fall under 3:1 on cream."""
    assert len(brand.FILL_STEPS) == 3
    assert brand.FILL_STEPS[0] == THEME["colors"]["ink"]


def test_theme_override_deep_merges(tmp_path, monkeypatch):
    override = tmp_path / "brand.json"
    override.write_text(json.dumps({"colors": {"accent": "#00FF00"}}), encoding="utf-8")
    monkeypatch.setenv("CITY_REPORT_BRAND_FILE", str(override))
    theme = brand.load_theme()
    assert theme["colors"]["accent"] == "#00FF00"
    # Untouched keys survive the merge.
    assert theme["colors"]["paper"] == "#F5F0E6"


def test_broken_or_missing_brand_file_falls_back_silently(tmp_path, monkeypatch):
    """A bad brand file must never stop a report from generating."""
    monkeypatch.setenv("CITY_REPORT_BRAND_FILE", str(tmp_path / "absent.json"))
    assert brand.load_theme()["colors"]["accent"] == "#E8501F"

    bad = tmp_path / "bad.json"
    bad.write_text("[not an object]", encoding="utf-8")
    monkeypatch.setenv("CITY_REPORT_BRAND_FILE", str(bad))
    assert brand.load_theme()["colors"]["accent"] == "#E8501F"


def test_no_brand_file_env_uses_default(monkeypatch):
    monkeypatch.delenv("CITY_REPORT_BRAND_FILE", raising=False)
    assert brand.load_theme()["name"] == "press"


# ---------------------------------------------------------------- charts


def test_sparkline_renders_and_labels_its_endpoint():
    svg = charts.sparkline({"2013": 100.0, "2024": 150.0}, THEME, label="Pop")
    assert svg.startswith("<svg")
    assert "2013" in svg and "2024" in svg
    assert "<title>2024: 150</title>" in svg


def test_sparkline_needs_two_points():
    assert charts.sparkline({"2024": 1.0}, THEME) == ""
    assert charts.sparkline({}, THEME) == ""


def test_sparkline_right_gutter_grows_with_the_label():
    """A fixed pad clipped "$80,846" off the edge of the viewBox."""
    short = charts.sparkline({"2013": 1.0, "2024": 5.0}, THEME,
                             value_format=lambda v: "5%")
    long = charts.sparkline({"2013": 1.0, "2024": 5.0}, THEME,
                            value_format=lambda v: "$1,234,567")

    def line_end(svg):
        return float(re.findall(r"L([\d.]+),", svg)[-1])

    assert line_end(long) < line_end(short)


def test_sparkline_flat_series_does_not_divide_by_zero():
    assert "<svg" in charts.sparkline({"2013": 5.0, "2024": 5.0}, THEME)
    assert "<svg" in charts.sparkline({"2013": 0.0, "2024": 0.0}, THEME)


def test_ranked_bars_labels_every_value_and_uses_no_accent():
    cats = [{"label": "A", "value": 100.0}, {"label": "B", "value": 10.0}]
    svg = charts.ranked_bars(cats, THEME)
    assert svg.count("<title>") == 2
    # Ink only: rank already says which bar leads.
    assert THEME["colors"]["accent"] not in svg


def test_ranked_bars_respects_the_limit():
    cats = [{"label": f"C{i}", "value": float(20 - i)} for i in range(20)]
    assert charts.ranked_bars(cats, THEME, limit=6).count("<title>") == 6


def test_ranked_bars_truncates_long_labels_but_keeps_the_full_name_in_the_title():
    long = "Professional, Scientific, & Management, & Administrative Services"
    svg = charts.ranked_bars([{"label": long, "value": 1.0}], THEME)
    assert "…" in svg
    # Survives in full inside the <title>, HTML-escaped.
    assert long.replace("&", "&amp;") in svg


def test_ranked_bars_tiny_bar_keeps_its_value_clear_of_the_gutter():
    cats = [{"label": "Big", "value": 1000.0}, {"label": "Tiny", "value": 0.0}]
    svg = charts.ranked_bars(cats, THEME)
    xs = [float(x) for x in re.findall(r'<text x="([\d.]+)" y="[\d.]+" fill="#181510" '
                                       r'font-size="11.5" font-weight="700"', svg)]
    assert all(x > charts.LABEL_GUTTER for x in xs)


def test_ranked_bars_empty():
    assert charts.ranked_bars([], THEME) == ""


def test_stacked_bar_caps_at_three_segments_and_gaps_them():
    cats = [{"label": f"S{i}", "value": 10.0} for i in range(5)]
    svg = charts.stacked_bar(cats, THEME)
    assert svg.count("<title>") == 3
    assert "%" in svg


def test_stacked_bar_skips_inline_label_when_the_segment_is_too_narrow():
    cats = [{"label": "Huge", "value": 1000.0}, {"label": "Sliver", "value": 1.0}]
    svg = charts.stacked_bar(cats, THEME)
    # Two segments, but only the wide one carries an inline percentage.
    assert svg.count(f'fill="{THEME["colors"]["paper"]}"') == 1


def test_stacked_bar_empty_and_all_zero():
    assert charts.stacked_bar([], THEME) == ""
    assert charts.stacked_bar([{"label": "A", "value": 0.0}], THEME) == ""


def test_histogram_preserves_order_and_highlights_one_bucket():
    cats = [{"label": f"B{i}", "value": float(i)} for i in range(6)]
    svg = charts.histogram(cats, THEME, highlight=3)
    assert svg.count("<title>") == 6
    assert THEME["colors"]["accent"] in svg
    assert "B0" in svg and "B5" in svg


def test_histogram_without_highlight_is_pure_ink():
    cats = [{"label": "A", "value": 1.0}, {"label": "B", "value": 2.0}]
    assert THEME["colors"]["accent"] not in charts.histogram(cats, THEME)


def test_histogram_empty_and_all_zero():
    assert charts.histogram([], THEME) == ""
    assert "<svg" in charts.histogram([{"label": "A", "value": 0.0}], THEME)


def test_bar_paths_degenerate_safely():
    assert charts._rounded_end_bar(0, 0, 0, 20) == ""
    assert charts._rounded_cap_column(0, 0, 20, 0) == ""
    assert "h" in charts._rounded_end_bar(0, 0, 0.4, 20)
    assert "h" in charts._rounded_cap_column(0, 0, 20, 0.4)


def test_svg_escapes_hostile_labels():
    """A member caption is API-supplied text and lands inside markup."""
    svg = charts.ranked_bars(
        [{"label": '<script>alert("x")</script>', "value": 1.0}], THEME)
    assert "<script>" not in svg
    assert "&lt;script&gt;" in svg


def test_truncate_helper():
    assert charts._truncate("short", 10) == "short"
    assert charts._truncate("a" * 30, 10).endswith("…")


# --------------------------------------------------- two-series comparison
#
# City A is ink, city B is the accent. Validated at ΔE 47.6 normal-vision and
# 35.5 protan against ink — comfortably above the separation floor — and a
# legend is always present, so identity never rests on the hue alone.


def test_legend_pairs_labels_with_the_series_colors():
    html = charts.legend(["Hawley, MN", "Fargo, ND"], THEME)
    assert html.count('class="key"') == 2
    assert THEME["colors"]["ink"] in html
    assert THEME["colors"]["accent"] in html
    assert "Hawley, MN" in html


def test_legend_escapes_labels():
    assert "<b>" not in charts.legend(["<b>x</b>", "y"], THEME)


def test_dual_sparkline_draws_both_series_on_one_scale():
    svg = charts.dual_sparkline({"2013": 1.0, "2024": 2.0},
                                {"2013": 3.0, "2024": 4.0}, THEME)
    assert svg.count("<path") == 2
    assert svg.count("<circle") == 2
    assert THEME["colors"]["accent"] in svg


def test_dual_sparkline_tolerates_one_short_series():
    """Cities publish different year ranges; the shorter one just isn't drawn."""
    svg = charts.dual_sparkline({"2013": 1.0, "2024": 2.0}, {"2024": 9.0}, THEME)
    assert svg.count("<path") == 1
    assert charts.dual_sparkline({"2024": 1.0}, {"2024": 2.0}, THEME) == ""


def test_dual_sparkline_flat_series_does_not_divide_by_zero():
    assert "<svg" in charts.dual_sparkline({"2013": 5.0, "2024": 5.0},
                                           {"2013": 5.0, "2024": 5.0}, THEME)


def test_paired_bars_draws_two_bars_per_row():
    rows = [{"label": "White", "a": 93.0, "b": 80.0},
            {"label": "Black", "a": 0.4, "b": 8.6}]
    svg = charts.paired_bars(rows, THEME)
    assert svg.count("<title>") == 4          # two cities x two categories
    assert THEME["colors"]["accent"] in svg
    assert "White" in svg


def test_paired_bars_zero_value_still_labels_clear_of_the_gutter():
    svg = charts.paired_bars([{"label": "None", "a": 0.0, "b": 5.0}], THEME)
    xs = [float(x) for x in re.findall(r'<text x="([\d.]+)" y="[\d.]+" '
                                       r'fill="#[0-9A-Fa-f]{6}" font-size="10"', svg)]
    assert all(x > charts.LABEL_GUTTER for x in xs)


def test_paired_bars_empty_and_all_zero():
    assert charts.paired_bars([], THEME) == ""
    assert "<svg" in charts.paired_bars([{"label": "a", "a": 0.0, "b": 0.0}], THEME)
