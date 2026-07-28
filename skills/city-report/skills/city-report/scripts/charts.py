"""Inline SVG chart primitives in the PRESS voice.

Hand-built SVG rather than a plotting library, for three reasons: a report
renders in milliseconds with no import cost, the output file is self-contained
with nothing to fetch, and the marks obey the brand exactly instead of being
talked out of a library's defaults.

Mark specs follow the ``dataviz`` skill: bars capped at 24px with a 4px rounded
data-end square at the baseline, 2px lines with round caps, end markers at r≥4
carrying a 2px paper ring, hairline recessive gridlines, and a 2px paper gap
between touching marks. Labels are selective — the endpoint, the extreme, the
one figure the block is about — never a number on every mark.

Color encodes magnitude only. Every chart here is single-hue ink, so identity
always comes from a written label rather than from a hue the reader has to
match against a key — which is both the PRESS rule and the reason this palette
never needs to pass a categorical-separation check.

The accent appears in exactly one chart: the histogram's median bucket. PRESS
allows one loud mark per document and that mark has to earn it. Accenting the
leading bar of every ranked chart was tried and removed — with eight charts on
a page it stops reading as emphasis and starts reading as decoration, and rank
already says which bar leads. The median bucket is different: it is the one
reading that turns a distribution's shape into a fact.

Hover is native: each mark carries an SVG ``<title>``, so browsers show a real
tooltip with the full label and exact value without a line of JavaScript. Every
chart is also paired with a table view by its caller, so no value is reachable
only by hovering.
"""
from __future__ import annotations

from html import escape

#: Bar thickness cap from the mark spec — the band's leftover becomes air.
BAR_THICKNESS = 22
BAR_GAP = 10
#: Radius of the data-end. The baseline end stays square.
END_RADIUS = 4
#: Width of the paper gap separating touching marks.
SURFACE_GAP = 2


def _esc(text) -> str:
    return escape(str(text), quote=True)


def _rounded_end_bar(x: float, y: float, width: float, height: float,
                     radius: float = END_RADIUS) -> str:
    """Path for a horizontal bar: square at the baseline, rounded at the tip.

    Degenerates to a plain rectangle when the bar is shorter than its own
    corner radius, which is what keeps a near-zero value from rendering as a
    lopsided blob.
    """
    r = min(radius, max(width, 0) / 2, height / 2)
    if width <= 0:
        return ""
    if r <= 0.5:
        return f'<path d="M{x},{y} h{width} v{height} h{-width} Z"/>'
    return (
        f'<path d="M{x},{y} h{width - r} a{r},{r} 0 0 1 {r},{r} '
        f'v{height - 2 * r} a{r},{r} 0 0 1 {-r},{r} h{-(width - r)} Z"/>'
    )


def _rounded_cap_column(x: float, y: float, width: float, height: float,
                        radius: float = END_RADIUS) -> str:
    """Path for a vertical column: rounded cap on top, square at the baseline."""
    r = min(radius, width / 2, max(height, 0) / 2)
    if height <= 0:
        return ""
    if r <= 0.5:
        return f'<path d="M{x},{y} h{width} v{height} h{-width} Z"/>'
    return (
        f'<path d="M{x},{y + r} a{r},{r} 0 0 1 {r},{-r} h{width - 2 * r} '
        f'a{r},{r} 0 0 1 {r},{r} v{height - r} h{-width} Z"/>'
    )


def _truncate(text: str, limit: int) -> str:
    """Shorten a category label for the axis gutter.

    The untruncated name always survives in the mark's ``<title>`` and in the
    table view, so nothing is lost — but a label that runs past its gutter
    collides with the bars, and clipping it with ``overflow:hidden`` crops
    characters, which reads worse than an honest ellipsis.
    """
    text = str(text)
    return text if len(text) <= limit else text[: limit - 1].rstrip(" ,&") + "…"


def sparkline(series: dict, theme: dict, width: int = 300, height: int = 68,
              value_format=None, label: str = "") -> str:
    """A single-series trend line with a labelled endpoint.

    One series, so no legend — the block's own heading names what is plotted.
    The endpoint is marked and labelled because it is the figure the reader
    came for; everything else is carried by the line's shape and the table view.
    """
    c = theme["colors"]
    points = [(int(y), v) for y, v in sorted(series.items(), key=lambda kv: int(kv[0]))]
    if len(points) < 2:
        return ""

    fmt = value_format or (lambda v: f"{v:,.0f}")
    years = [p[0] for p in points]
    values = [p[1] for p in points]
    lo, hi = min(values), max(values)
    span = (hi - lo) or (abs(hi) or 1)

    # The right gutter is measured from the label that will actually be drawn,
    # not fixed: "$80,846" and "33.4 yrs" are far wider than "5.9%", and a
    # constant pad clips the long ones off the edge of the viewBox.
    end_label = fmt(values[-1])
    pad_l, pad_t, pad_b = 2, 12, 16
    pad_r = 16 + int(len(end_label) * 7.3)
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    def px(year: int) -> float:
        return pad_l + (year - years[0]) / max(years[-1] - years[0], 1) * plot_w

    def py(value: float) -> float:
        return pad_t + (1 - (value - lo) / span) * plot_h

    path = " ".join(
        f"{'M' if i == 0 else 'L'}{px(y):.1f},{py(v):.1f}"
        for i, (y, v) in enumerate(points))
    end_x, end_y = px(years[-1]), py(values[-1])

    body = [
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'role="img" aria-label="{_esc(label or "trend")}, '
        f'{years[0]} to {years[-1]}">',
        # Baseline: hairline, solid, one step off the surface — recessive.
        f'<line x1="{pad_l}" y1="{pad_t + plot_h:.1f}" x2="{pad_l + plot_w}" '
        f'y2="{pad_t + plot_h:.1f}" stroke="{c["dim"]}" stroke-width="1" opacity="0.35"/>',
        f'<path d="{path}" fill="none" stroke="{c["ink"]}" stroke-width="2" '
        f'stroke-linejoin="round" stroke-linecap="round"/>',
        # End marker: r=4 (the 8px minimum) inside a 2px paper ring so it stays
        # legible where it sits on the line. Ink, not accent — see the module
        # docstring on why the accent stays out of the charts.
        f'<circle cx="{end_x:.1f}" cy="{end_y:.1f}" r="4" fill="{c["ink"]}" '
        f'stroke="{c["paper"]}" stroke-width="2">'
        f'<title>{_esc(years[-1])}: {_esc(end_label)}</title></circle>',
        f'<text x="{end_x + 8:.1f}" y="{end_y + 4:.1f}" fill="{c["ink"]}" '
        f'font-size="12" font-weight="700" font-family="ui-monospace, monospace">'
        f'{_esc(end_label)}</text>',
        f'<text x="{pad_l}" y="{height - 3}" fill="{c["dim"]}" font-size="10" '
        f'font-family="ui-monospace, monospace">{years[0]}</text>',
        f'<text x="{pad_l + plot_w:.1f}" y="{height - 3}" fill="{c["dim"]}" '
        f'font-size="10" text-anchor="end" font-family="ui-monospace, monospace">'
        f'{years[-1]}</text>',
        "</svg>",
    ]
    return "".join(body)


#: Character budget for the category gutter, and the gutter's width in px.
#: The two are tied: at 11.5px mono a glyph is ~6.9px wide, so 22 characters
#: need ~152px. Letting the budget drift wider than the gutter is what makes
#: labels run under the bars.
LABEL_CHARS = 22
LABEL_GUTTER = 164


def ranked_bars(categories: list[dict], theme: dict, limit: int = 8,
                width: int = 460, value_format=None) -> str:
    """Horizontal bars, largest first, each labelled with its own value.

    The dominant form in this report, and deliberately so: ranked bars carry
    identity in written labels, so a fifteen-category breakdown needs no
    categorical palette and no legend — rank itself says which bar leads, so
    nothing has to be painted to say it.
    """
    c = theme["colors"]
    rows = categories[:limit]
    if not rows:
        return ""

    fmt = value_format or (lambda v: f"{v:,.0f}")
    value_w = 76
    plot_w = width - LABEL_GUTTER - value_w
    row_h = BAR_THICKNESS + BAR_GAP
    height = row_h * len(rows)
    peak = max((r["value"] for r in rows), default=0) or 1

    out = [f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'role="img" aria-label="Ranked bar chart, {len(rows)} categories">']
    for i, row in enumerate(rows):
        y = i * row_h + BAR_GAP / 2
        bar_w = max(row["value"] / peak * plot_w, 0)
        baseline = y + BAR_THICKNESS * 0.72
        out.append(f'<g><title>{_esc(row["label"])}: {_esc(fmt(row["value"]))}</title>')
        out.append(
            f'<text x="0" y="{baseline:.1f}" fill="{c["ink"]}" '
            f'font-size="11.5" font-family="ui-monospace, monospace">'
            f'{_esc(_truncate(row["label"], LABEL_CHARS))}</text>')
        out.append(f'<g fill="{c["ink"]}" transform="translate({LABEL_GUTTER},{y:.1f})">'
                   + _rounded_end_bar(0, 0, bar_w, BAR_THICKNESS) + "</g>")
        # Value at the tip. A near-zero bar would otherwise put its value hard
        # against the gutter text, so the label is floored a few px clear of
        # the baseline regardless of how short the bar is.
        out.append(
            f'<text x="{LABEL_GUTTER + max(bar_w, 2) + 7:.1f}" y="{baseline:.1f}" '
            f'fill="{c["ink"]}" font-size="11.5" font-weight="700" '
            f'font-family="ui-monospace, monospace">{_esc(fmt(row["value"]))}</text>')
        out.append("</g>")
    out.append("</svg>")
    return "".join(out)


def stacked_bar(categories: list[dict], theme: dict, width: int = 460,
                value_format=None) -> str:
    """A single horizontal 100% bar, for a two- or three-way split.

    Capped at three segments on purpose. The fill ramp only has three steps
    that clear 3:1 contrast on cream, and beyond three parts an inline label
    stops fitting inside its own segment — at which point ranked bars are the
    honest form. Segments are separated by a 2px paper gap, never a stroke.
    """
    c = theme["colors"]
    rows = [r for r in categories if r["value"] > 0][:3]
    total = sum(r["value"] for r in rows)
    if not rows or total <= 0:
        return ""

    fmt = value_format or (lambda v: f"{v:,.0f}")
    from brand import FILL_STEPS

    bar_h, label_h = 30, 20
    height = bar_h + label_h + 8
    out = [f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'role="img" aria-label="Share breakdown, {len(rows)} parts">']

    x = 0.0
    for i, row in enumerate(rows):
        share = row["value"] / total
        seg_w = share * width
        # The gap comes out of every segment but the last, so the bar still
        # spans the full width.
        draw_w = max(seg_w - (SURFACE_GAP if i < len(rows) - 1 else 0), 0)
        fill = FILL_STEPS[i] if i < len(FILL_STEPS) else c["dim"]
        pct = f"{share * 100:.0f}%"
        out.append(f'<g><title>{_esc(row["label"])}: {_esc(fmt(row["value"]))} '
                   f'({pct})</title>')
        out.append(f'<rect x="{x:.1f}" y="0" width="{draw_w:.1f}" height="{bar_h}" '
                   f'fill="{fill}"/>')
        # Only label inside the segment when the text demonstrably fits; a
        # cropped label is worse than none, and the value survives in the
        # table view either way.
        if draw_w > 46:
            out.append(
                f'<text x="{x + 9:.1f}" y="{bar_h * 0.64:.1f}" fill="{c["paper"]}" '
                f'font-size="12" font-weight="700" '
                f'font-family="ui-monospace, monospace">{pct}</text>')
        out.append(
            f'<text x="{x:.1f}" y="{bar_h + label_h - 3}" fill="{c["dim"]}" '
            f'font-size="10.5" font-family="ui-monospace, monospace">'
            f'{_esc(_truncate(row["label"], 22))}</text>')
        out.append("</g>")
        x += seg_w
    out.append("</svg>")
    return "".join(out)


#: Thickness of one bar in a paired comparison row. Half a normal bar, so the
#: two cities read as a single row rather than two unrelated entries.
PAIR_THICKNESS = 9


def legend(labels: list[str], theme: dict) -> str:
    """Legend markup for a two-series comparison chart.

    Always rendered when a chart carries two cities — identity must never
    depend on the reader matching a hue from memory. The swatch carries the
    series color; the text stays in ink, per the rule that text never wears the
    data color.
    """
    c = theme["colors"]
    colors = (c["ink"], c["accent"])
    items = "".join(
        f'<span class="key"><i style="background:{colors[i % 2]}"></i>'
        f'{_esc(label)}</span>'
        for i, label in enumerate(labels))
    return f'<div class="legend">{items}</div>'


def dual_sparkline(series_a: dict, series_b: dict, theme: dict,
                   width: int = 300, height: int = 74, value_format=None,
                   label: str = "") -> str:
    """Two cities' trends on one set of axes.

    Both series share a scale — the whole point is that the gap between the
    lines is readable — so this is emphatically not a dual-axis chart. Where
    the two cities' published years differ, each line simply spans its own
    range rather than being padded or interpolated to match.
    """
    c = theme["colors"]
    pts_a = [(int(y), v) for y, v in sorted(series_a.items(), key=lambda kv: int(kv[0]))]
    pts_b = [(int(y), v) for y, v in sorted(series_b.items(), key=lambda kv: int(kv[0]))]
    if len(pts_a) < 2 and len(pts_b) < 2:
        return ""

    fmt = value_format or (lambda v: f"{v:,.0f}")
    all_pts = pts_a + pts_b
    years = [p[0] for p in all_pts]
    values = [p[1] for p in all_pts]
    y0, y1 = min(years), max(years)
    lo, hi = min(values), max(values)
    span = (hi - lo) or (abs(hi) or 1)

    widest = max((len(fmt(p[1])) for p in (pts_a[-1:] + pts_b[-1:])), default=6)
    pad_l, pad_t, pad_b = 2, 12, 16
    pad_r = 16 + int(widest * 7.3)
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    def px(year):
        return pad_l + (year - y0) / max(y1 - y0, 1) * plot_w

    def py(value):
        return pad_t + (1 - (value - lo) / span) * plot_h

    out = [f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'role="img" aria-label="{_esc(label or "comparison")}, {y0} to {y1}">',
           f'<line x1="{pad_l}" y1="{pad_t + plot_h:.1f}" x2="{pad_l + plot_w}" '
           f'y2="{pad_t + plot_h:.1f}" stroke="{c["dim"]}" stroke-width="1" '
           f'opacity="0.35"/>']

    for points, color in ((pts_a, c["ink"]), (pts_b, c["accent"])):
        if len(points) < 2:
            continue
        path = " ".join(f"{'M' if i == 0 else 'L'}{px(y):.1f},{py(v):.1f}"
                        for i, (y, v) in enumerate(points))
        end_x, end_y = px(points[-1][0]), py(points[-1][1])
        out.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2" '
                   f'stroke-linejoin="round" stroke-linecap="round"/>')
        out.append(f'<circle cx="{end_x:.1f}" cy="{end_y:.1f}" r="4" fill="{color}" '
                   f'stroke="{c["paper"]}" stroke-width="2">'
                   f'<title>{_esc(points[-1][0])}: {_esc(fmt(points[-1][1]))}</title>'
                   f'</circle>')
        out.append(f'<text x="{end_x + 8:.1f}" y="{end_y + 4:.1f}" fill="{color}" '
                   f'font-size="11.5" font-weight="700" '
                   f'font-family="ui-monospace, monospace">{_esc(fmt(points[-1][1]))}'
                   f'</text>')

    out.append(f'<text x="{pad_l}" y="{height - 3}" fill="{c["dim"]}" font-size="10" '
               f'font-family="ui-monospace, monospace">{y0}</text>')
    out.append(f'<text x="{pad_l + plot_w:.1f}" y="{height - 3}" fill="{c["dim"]}" '
               f'font-size="10" text-anchor="end" '
               f'font-family="ui-monospace, monospace">{y1}</text>')
    out.append("</svg>")
    return "".join(out)


def paired_bars(rows: list[dict], theme: dict, width: int = 460,
                value_format=None) -> str:
    """One row per category, two thin bars — city A over city B.

    ``rows`` carry ``label``, ``a`` and ``b``. Callers pass **shares, not
    counts**: comparing a 2,178-person town's raw category counts against a
    131,627-person city's makes every bar in the small town invisible and
    measures population rather than composition.
    """
    c = theme["colors"]
    if not rows:
        return ""
    fmt = value_format or (lambda v: f"{v:.0f}%")

    value_w = 62
    plot_w = width - LABEL_GUTTER - value_w
    row_h = PAIR_THICKNESS * 2 + SURFACE_GAP + BAR_GAP
    height = row_h * len(rows)
    peak = max(max(r["a"], r["b"]) for r in rows) or 1

    out = [f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'role="img" aria-label="Paired comparison, {len(rows)} categories">']
    for i, row in enumerate(rows):
        top = i * row_h + BAR_GAP / 2
        out.append(
            f'<text x="0" y="{top + PAIR_THICKNESS + 3:.1f}" fill="{c["ink"]}" '
            f'font-size="11.5" font-family="ui-monospace, monospace">'
            f'{_esc(_truncate(row["label"], LABEL_CHARS))}</text>')
        for j, (value, color) in enumerate(((row["a"], c["ink"]),
                                            (row["b"], c["accent"]))):
            y = top + j * (PAIR_THICKNESS + SURFACE_GAP)
            bar_w = max(value / peak * plot_w, 0)
            out.append(
                f'<g fill="{color}" transform="translate({LABEL_GUTTER},{y:.1f})">'
                f'<title>{_esc(row["label"])}: {_esc(fmt(value))}</title>'
                + _rounded_end_bar(0, 0, bar_w, PAIR_THICKNESS, radius=2) + "</g>")
            out.append(
                f'<text x="{LABEL_GUTTER + max(bar_w, 2) + 6:.1f}" '
                f'y="{y + PAIR_THICKNESS - 0.5:.1f}" fill="{color}" font-size="10" '
                f'font-weight="700" font-family="ui-monospace, monospace">'
                f'{_esc(fmt(value))}</text>')
    out.append("</svg>")
    return "".join(out)


def histogram(categories: list[dict], theme: dict, width: int = 460,
              height: int = 150, highlight: int | None = None,
              value_format=None) -> str:
    """Columns over ordered buckets, with one optional highlighted bucket.

    Used for the income and home-value distributions, where the buckets have a
    natural order that must be preserved — so unlike ``ranked_bars`` this never
    sorts. ``highlight`` marks the bucket the median falls in, which is the one
    reading that turns a shape into a fact.
    """
    c = theme["colors"]
    rows = categories
    if not rows:
        return ""

    fmt = value_format or (lambda v: f"{v:,.0f}")
    pad_b, pad_t = 26, 12
    plot_h = height - pad_b - pad_t
    slot = width / len(rows)
    bar_w = min(slot - SURFACE_GAP, BAR_THICKNESS)
    peak = max((r["value"] for r in rows), default=0) or 1

    out = [f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'role="img" aria-label="Distribution across {len(rows)} brackets">',
           f'<line x1="0" y1="{pad_t + plot_h}" x2="{width}" y2="{pad_t + plot_h}" '
           f'stroke="{c["dim"]}" stroke-width="1" opacity="0.35"/>']
    for i, row in enumerate(rows):
        bar_h = row["value"] / peak * plot_h
        x = i * slot + (slot - bar_w) / 2
        y = pad_t + plot_h - bar_h
        fill = c["accent"] if highlight == i else c["ink"]
        out.append(f'<g fill="{fill}"><title>{_esc(row["label"])}: '
                   f'{_esc(fmt(row["value"]))}</title>'
                   + _rounded_cap_column(x, y, bar_w, bar_h) + "</g>")
    # Only the ends of the axis are labelled: a tick under all 26 value buckets
    # is unreadable, and the table view carries every bracket by name.
    out.append(f'<text x="0" y="{height - 8}" fill="{c["dim"]}" font-size="10" '
               f'font-family="ui-monospace, monospace">'
               f'{_esc(_truncate(rows[0]["label"], 16))}</text>')
    out.append(f'<text x="{width}" y="{height - 8}" fill="{c["dim"]}" font-size="10" '
               f'text-anchor="end" font-family="ui-monospace, monospace">'
               f'{_esc(_truncate(rows[-1]["label"], 16))}</text>')
    out.append("</svg>")
    return "".join(out)
