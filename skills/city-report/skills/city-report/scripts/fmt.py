"""Value formatting, shared by the terminal digest and the HTML report.

One module so a figure reads identically wherever it appears — a number that
says ``$80,846`` in chat and ``80846`` in the report invites the reader to
wonder which one is the real value.
"""
from __future__ import annotations

UNIT_SUFFIX = {"percent": "%", "minutes": " min", "years": " yrs"}


def format_value(value, unit: str = "count") -> str:
    """Render ``value`` in its unit's conventional form.

    Percentages and rates keep one decimal — ACS estimates do not justify two,
    and a rate printed to two decimals implies a precision the margin of error
    does not support.
    """
    if value is None:
        return "—"
    if unit == "usd":
        return f"${value:,.0f}"
    if unit == "percent":
        return f"{value:.1f}%"
    if unit == "ratio":
        return f"{value:.3f}"
    if unit in ("years", "minutes"):
        return f"{value:.1f}{UNIT_SUFFIX[unit]}"
    return f"{value:,.0f}"


def format_compact(value, unit: str = "count") -> str:
    """A shortened form for the masthead, where width is scarce.

    Only counts and dollars shorten; a median age of ``33.4`` must not become
    ``33``, and a rate is already short.
    """
    if value is None:
        return "—"
    if unit in ("percent", "ratio", "years", "minutes"):
        return format_value(value, unit)
    prefix = "$" if unit == "usd" else ""
    magnitude = abs(value)
    if magnitude >= 1_000_000:
        return f"{prefix}{value / 1_000_000:.1f}M"
    if magnitude >= 100_000:
        return f"{prefix}{value / 1_000:.0f}K"
    return f"{prefix}{value:,.0f}"


def format_moe(moe, unit: str = "count") -> str:
    """The ``± x`` companion to an estimate."""
    if moe is None:
        return ""
    return f"± {format_value(moe, unit).lstrip('$')}"


def compare(value, benchmark, unit: str) -> str:
    """Phrase a place's value against a benchmark, e.g. ``"12% above MN"``.

    Percentage-point units are compared by difference and everything else by
    ratio, because "18% higher than a 5.6% uninsured rate" is ambiguous in a
    way "+1.2 pts" is not.
    """
    if value is None or benchmark in (None, 0):
        return "—"
    if unit in ("percent", "ratio"):
        delta = value - benchmark
        sign = "+" if delta >= 0 else "−"
        return f"{sign}{abs(delta):.1f}{'%' if unit == 'percent' else ''} pts"
    ratio = (value - benchmark) / abs(benchmark) * 100
    if abs(ratio) < 0.5:
        return "on par"
    return f"{'+' if ratio >= 0 else '−'}{abs(ratio):.0f}%"


#: How a benchmark level is named in prose.
BENCH_LABEL = {"State": "state", "Nation": "US"}


def context_bits(metric: dict) -> list[str]:
    """The comparison phrases that give a figure meaning.

    Rates and medians compare against the state and the nation; counts compare
    against their own history, because a city's population is a *part of* its
    state's and the ratio between them says nothing. Shared by the digest, the
    report and the query CLI so all three phrase a comparison identically.
    """
    bits = []
    for level, value in (metric.get("benchmarks") or {}).items():
        bits.append(f'{compare(metric["latest"], value["value"], metric["unit"])} '
                    f'vs {BENCH_LABEL.get(level, level)}')
    growth = metric.get("growth")
    if growth and growth.get("pct") is not None:
        sign = "+" if growth["pct"] >= 0 else "−"
        bits.append(f'{sign}{abs(growth["pct"]):.0f}% since {growth["from_year"]}')
    return bits
