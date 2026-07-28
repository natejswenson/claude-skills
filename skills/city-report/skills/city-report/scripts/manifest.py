"""The verified metric manifest — this skill's accuracy asset.

Every number the skill can report comes from an entry in ``METRICS`` below.
Nothing composes a Data USA query at runtime. That is the whole design, and it
exists because the Data USA API's failure mode is *silently wrong numbers*, not
errors (see ``references/api-gotchas.md`` for the full field notes).

The trap that motivates the manifest: tesseract aggregates a measure over every
dimension you did NOT drill down on. Asking ``acs_yg_household_income_5`` for
Minneapolis without drilling on the income bucket returns ``165438`` — a *count
of households*, summed over all 16 buckets — which reads exactly like a
plausible median income and is off by three orders of magnitude. Nothing in the
response says so.

So each entry pins the cube, the exact drilldown set, the measure, and a
``kind`` that says how to turn rows into a number. ``tests/test_manifest.py``
asserts, against the live cube schemas, that every entry's drilldowns cover
every non-Year, non-Geography dimension of its cube — which makes an accidental
cross-dimension sum structurally impossible to reintroduce.

Two cubes that look right are dead and must never be used:

* ``acs_yg_total_population_5`` — the *official docs' own example cube* — returns
  HTTP 200 with zero rows at every geography level. Population comes from the
  race cube instead.
* ``acs_yg_housing_median_value_5`` — HTTP 500 on every query. Median home value
  is interpolated from the value-bucket histogram and labelled as an estimate.

All cubes here are ``_5`` (ACS 5-year). The ``_1`` variants carry only 675
places (population 65k+); ``_5`` carries all 29,576. Choosing ``_1`` gives you a
skill that works in Minneapolis and fails in every small town.
"""
from __future__ import annotations

from dataclasses import dataclass, field

#: ACS 5-year estimates. Stated on every report — a vintage-less figure is a
#: wrong figure, since "median income" means nothing without the survey window.
VINTAGE = "ACS 5-year estimate"

#: Above this ratio of margin-of-error to estimate, a figure is too noisy to
#: state plainly. The Census publishes MOEs precisely because small-place
#: estimates are soft; a 300-person town's "median income" can carry a margin
#: wider than the estimate itself. Such figures render with ± and a wide-margin
#: note rather than being silently presented as precise.
MOE_WIDE_RATIO = 0.30

SECTIONS = (
    ("people", "People"),
    ("economy", "Economy"),
    ("housing", "Housing"),
    ("work", "Work & Commute"),
    ("health", "Health"),
)


def moe_name(measure: str) -> str:
    """The Census margin-of-error measure paired with ``measure``.

    Usually ``"<measure> Moe"``, but cubes whose measure names carry a level
    suffix after a colon insert it *before* the colon instead:
    ``"Median Earnings by Industry: Industry Group"`` pairs with
    ``"Median Earnings by Industry Moe: Industry Group"``. Appending blindly
    names a measure that does not exist — and the API answers that request with
    HTTP 200, the estimate, and no MOE column rather than an error, so the
    margin just silently goes missing.

    Module-level, not just a ``Metric`` property, because the fetch layer builds
    its request from de-duplicated ``(cube, drilldowns, measure)`` triples and
    has no ``Metric`` in hand. Two copies of this rule is exactly how the
    margins went missing the first time.
    """
    head, sep, tail = measure.partition(": ")
    return f"{head} Moe{sep}{tail}" if sep else f"{measure} Moe"


@dataclass(frozen=True)
class Metric:
    """One pinned, verified query.

    ``kind`` decides how rows collapse into a reportable number:

    ``scalar``
        The cube has no dimension beyond Year/Geography, so each year is one
        row and one value. Safe for medians and indices (median age, GINI,
        mean commute time).
    ``total``
        Sum the measure across the drilled dimension, per year. ONLY valid when
        the measure is a count and the dimension partitions the population
        exactly once (population by ethnicity). Never valid on a median.
    ``member``
        Take one named member's value per year (median household income at
        ``Race = Total``). Used where the cube ships its own total.
    ``breakdown``
        Keep the members as categories for a single year — the input to a bar
        chart or a table. Never summed.
    ``rate``
        ``numerator`` members divided by the sum of all members, per year, as a
        share (poverty rate, uninsured rate, homeownership rate).
    ``derived_median``
        Interpolate a median from the drilled dimension's bucket histogram, per
        year. Exists because the cube that would publish a median home value
        directly returns HTTP 500 on every query — so the figure is computed
        here and always presented as an estimate.

    ``is_median`` marks measures that must never be summed or averaged across
    members; the guard test enforces that such metrics are never ``total``.
    """

    key: str
    section: str
    label: str
    cube: str
    drilldowns: tuple[str, ...]
    measure: str
    kind: str
    #: Member caption selected by ``kind="member"``.
    member: str | None = None
    #: Member captions forming the numerator of ``kind="rate"``.
    numerator: tuple[str, ...] = ()
    #: Members excluded from a ``breakdown`` (subtotals that would double-count).
    exclude: tuple[str, ...] = ()
    #: ``"after_dash"`` keeps only the text after the last ``-`` in a member
    #: caption. The health-coverage cube prefixes every member with its branch
    #: of the hierarchy ("With One Type of Health Insurance Coverage-With
    #: Employer-Based Health Insurance Only"), so eight labels truncate to the
    #: identical string in a chart gutter and the chart says nothing.
    label_style: str = "full"
    #: Display unit: "count", "usd", "years", "minutes", "ratio", "percent".
    unit: str = "count"
    #: True when the measure is a median/mean/index rather than a count.
    is_median: bool = False
    #: Reader-facing caption, shown under the figure in the serif commentary
    #: voice. This is published text — it explains the number to someone who
    #: has never heard of a tesseract cube. Rationale for *why* a query is
    #: shaped the way it is belongs in a code comment, not here.
    note: str = ""
    #: Benchmarked against state + nation in the headline strip.
    headline: bool = False
    #: Cubes whose first year of data is later than the usual 2013.
    first_year: int = 2013
    #: Dimensions this metric deliberately sums across, each with its reason.
    #:
    #: Summing an un-drilled dimension is safe for a **count** whose cube is a
    #: crosstab: every person falls in exactly one cell, so the sum is the
    #: marginal total. It is never safe for a **median or mean** — averaging
    #: medians produces a number with no meaning, and the API will compute it
    #: without complaint. ``test_drilldowns_cover_every_dimension`` enforces
    #: exactly that split: medians must drill or pin every dimension, counts
    #: may sum one that is named here.
    summed: dict[str, str] = field(default_factory=dict)

    @property
    def benchmarkable(self) -> bool:
        """Whether comparing this metric to a state or national figure means anything.

        Counts do not compare across geographies — "Minneapolis has 93% fewer
        people than Minnesota" is arithmetically true and completely useless,
        since a city is *part of* its state. Only rates, medians and indices
        are like-for-like at different scales. Count metrics carry a growth
        figure instead (see ``bundle.build_metric``).
        """
        return self.unit != "count"

    @property
    def moe_measure(self) -> str:
        """This metric's margin-of-error measure. See ``moe_name``."""
        return moe_name(self.measure)


METRICS: tuple[Metric, ...] = (
    # ---------------------------------------------------------------- people
    Metric(
        key="population",
        section="people",
        label="Population",
        cube="acs_ygr_race_with_hispanic_5",
        drilldowns=("Year", "Ethnicity"),
        measure="Hispanic Population",
        kind="total",
        unit="count",
        headline=True,
        # Ethnicity has exactly two members and NO "Total". Filtering to what
        # looks like a total (Ethnicity:0 = "Not Hispanic or Latino") silently
        # drops every Hispanic resident — 44,748 people in Minneapolis, 10% of
        # the city. Both members must be summed.
        summed={"Race": "race partitions each ethnicity exactly once, so "
                        "summing it yields that ethnicity's total population"},
        note="Sum of Hispanic and non-Hispanic residents.",
    ),
    Metric(
        key="race",
        section="people",
        label="Race",
        cube="acs_ygr_race_with_hispanic_5",
        drilldowns=("Year", "Race"),
        measure="Hispanic Population",
        kind="breakdown",
        unit="count",
        summed={"Ethnicity": "ethnicity partitions each race exactly once, so "
                             "summing it yields that race's total — this is the "
                             "race breakdown regardless of Hispanic origin"},
    ),
    Metric(
        key="median_age",
        section="people",
        label="Median age",
        cube="acs_ygs_median_age_total_5",
        # This cube carries a Gender dimension (Total / Men / Women). The
        # un-drilled query happens to return the Total member's value today,
        # but leaning on an implicit aggregate of a *median* is exactly the
        # fragility this manifest exists to remove — an aggregator change
        # upstream would silently start averaging the men's and women's
        # medians. Drill Gender and name the member.
        drilldowns=("Year", "Gender"),
        measure="Median Age",
        kind="member",
        member="Total",
        unit="years",
        is_median=True,
        headline=True,
    ),
    Metric(
        key="citizenship",
        section="people",
        label="Non-citizen share",
        cube="acs_ygc_citizenship_status_5",
        drilldowns=("Year", "Citizenship"),
        measure="Citizenship Status",
        kind="rate",
        numerator=("Non-Citizen",),
        unit="percent",
        summed={"Citizenship Status Granular": "a finer nesting of the same "
                                               "split; summing it returns each "
                                               "Citizenship member's own total"},
    ),
    Metric(
        key="foreign_born",
        section="people",
        label="Foreign-born residents by origin",
        cube="acs_ygf_place_of_birth_for_foreign_born_5",
        drilldowns=("Year", "Continent"),
        measure="Foreign-Born Citizens",
        kind="breakdown",
        unit="count",
        first_year=2015,
    ),
    Metric(
        key="veterans",
        section="people",
        label="Veterans by period of service",
        cube="acs_ygv_veterans_5",
        drilldowns=("Year", "Period of Service"),
        measure="Veterans",
        kind="breakdown",
        unit="count",
        summed={"Period of Service Granular": "a finer nesting of the same "
                                              "split; summing it returns each "
                                              "Period of Service member's total"},
    ),
    # --------------------------------------------------------------- economy
    Metric(
        key="median_household_income",
        section="economy",
        label="Median household income",
        cube="acs_ygr_median_household_income_race_5",
        drilldowns=("Year", "Race"),
        measure="Household Income by Race",
        kind="member",
        member="Total",
        unit="usd",
        is_median=True,
        headline=True,
        # NOT acs_yg_household_income_5 — that cube's measure is a household
        # COUNT per income bucket, not a median. This cube ships its own
        # "Total" member, which is the actual published median. See the module
        # docstring for the full trap.
    ),
    Metric(
        key="income_by_race",
        section="economy",
        label="Median household income by race",
        cube="acs_ygr_median_household_income_race_5",
        drilldowns=("Year", "Race"),
        measure="Household Income by Race",
        kind="breakdown",
        exclude=("Total",),
        unit="usd",
        is_median=True,
    ),
    Metric(
        key="income_distribution",
        section="economy",
        label="Households by income bracket",
        cube="acs_yg_household_income_5",
        drilldowns=("Year", "Household Income Bucket"),
        measure="Household Income",
        kind="breakdown",
        unit="count",
        note="Number of households in each bracket.",
    ),
    Metric(
        key="gini",
        section="economy",
        label="Wage inequality (GINI)",
        cube="acs_yg_gini_5",
        drilldowns=("Year",),
        measure="Wage GINI",
        kind="scalar",
        unit="ratio",
        is_median=True,
        note="0 = perfect equality, 1 = maximum inequality.",
    ),
    Metric(
        key="poverty_rate",
        section="economy",
        label="Poverty rate",
        cube="acs_ygpsar_poverty_by_gender_age_race_5",
        drilldowns=("Year", "Poverty Status"),
        measure="Poverty Population",
        kind="rate",
        numerator=("Income In The Past 12 Months Below Poverty Level",),
        unit="percent",
        headline=True,
        # Poverty Status alone is the split that matters; Gender, Age and Race
        # are crosstab axes over the same universe, so summing them returns the
        # marginal total per poverty status. Safe here precisely because the
        # measure is a count — the same sum on a median would be nonsense.
        summed={
            "Gender": "crosstab axis over the same universe; each person falls "
                      "in exactly one cell, so the sum is the marginal total",
            "Age": "crosstab axis over the same universe; summing gives the "
                   "marginal total per poverty status",
            "Race": "crosstab axis over the same universe; summing gives the "
                    "marginal total per poverty status",
        },
    ),
    Metric(
        key="earnings_by_industry",
        section="economy",
        label="Median earnings by industry",
        cube="acs_ygi_industry_for_median_earnings_5",
        drilldowns=("Year", "Industry Group"),
        measure="Median Earnings by Industry: Industry Group",
        kind="breakdown",
        # "Total" is the all-industry median; the un-suffixed Arts member
        # duplicates its "(Group)" sibling and would plot the bar twice.
        exclude=("Total", "Arts, Entertainment, & Recreation, & Accommodations & Food Services"),
        unit="usd",
        is_median=True,
    ),
    Metric(
        key="workforce_by_industry",
        section="economy",
        label="Workforce by industry",
        cube="acs_ygsi_gender_by_industry_c_5",
        drilldowns=("Year", "Group"),
        measure="Workforce by Industry and Gender",
        kind="breakdown",
        unit="count",
        summed={"Gender": "the workforce split by gender is not the question "
                          "here; summing both gives total workers per industry"},
    ),
    # --------------------------------------------------------------- housing
    Metric(
        key="homeownership_rate",
        section="housing",
        label="Homeownership rate",
        cube="acs_ygo_tenure_5",
        drilldowns=("Year", "Occupied By"),
        measure="Household Ownership",
        kind="rate",
        numerator=("Owner Occupied",),
        unit="percent",
        headline=True,
    ),
    Metric(
        key="tenure",
        section="housing",
        label="Owner- vs renter-occupied households",
        cube="acs_ygo_tenure_5",
        drilldowns=("Year", "Occupied By"),
        measure="Household Ownership",
        kind="breakdown",
        unit="count",
    ),
    Metric(
        key="median_home_value",
        section="housing",
        label="Median home value",
        # Shares its query with home_value_distribution below — `unique_queries`
        # de-duplicates, so this costs no extra request.
        cube="acs_ygo_housing_value_bucket_5",
        drilldowns=("Year", "Value Bucket"),
        measure="Property Value by Bucket",
        kind="derived_median",
        unit="usd",
        is_median=True,
        headline=True,
        first_year=2015,
        note="Interpolated from the value-bucket histogram — Data USA's "
             "median-value series returns no data at city level.",
    ),
    Metric(
        key="home_value_distribution",
        section="housing",
        label="Owner-occupied homes by value",
        cube="acs_ygo_housing_value_bucket_5",
        drilldowns=("Year", "Value Bucket"),
        measure="Property Value by Bucket",
        kind="breakdown",
        unit="count",
        first_year=2015,
        # The median-home-value cube (acs_yg_housing_median_value_5) returns
        # HTTP 500 on every query, so report.py interpolates the median from
        # these buckets and captions it as an estimate at the point of use.
    ),
    # ------------------------------------------------------------------ work
    Metric(
        key="commute_time",
        section="work",
        label="Average commute",
        cube="acs_ygt_mean_transportation_time_to_work_5",
        drilldowns=("Year",),
        measure="Average Commute Time",
        kind="scalar",
        unit="minutes",
        is_median=True,
        headline=True,
    ),
    Metric(
        key="commute_means",
        section="work",
        label="How people get to work",
        cube="acs_ygt_means_of_transportation_to_work_5",
        drilldowns=("Year", "Transportation Means"),
        measure="Commute Means",
        kind="breakdown",
        unit="count",
    ),
    Metric(
        key="no_internet",
        section="work",
        label="Households without internet",
        cube="acs_ygh_households_with_no_internet_2016_5",
        drilldowns=("Year", "Access Group"),
        measure="Households by Internet Access",
        kind="rate",
        numerator=("No Internet Access",),
        unit="percent",
        first_year=2017,
    ),
    # ---------------------------------------------------------------- health
    Metric(
        key="uninsured_rate",
        section="health",
        label="Uninsured rate",
        cube="acs_ygh_health_care_coverage_overall_5",
        drilldowns=("Year", "Health Coverage"),
        measure="Health Insurance Policies",
        kind="rate",
        numerator=("No Health Insurance Coverage",),
        unit="percent",
        headline=True,
        summed={
            "Age": "crosstab axis; summing gives the marginal total per "
                   "coverage type across all age bands",
            "Kaiser Health Coverage": "a parallel re-coding of the same "
                                      "coverage universe; summing it returns "
                                      "each Health Coverage member's own total",
        },
    ),
    Metric(
        key="coverage_types",
        section="health",
        label="Health coverage by type",
        cube="acs_ygh_health_care_coverage_overall_5",
        drilldowns=("Year", "Health Coverage"),
        measure="Health Insurance Policies",
        kind="breakdown",
        unit="count",
        label_style="after_dash",
        summed={
            "Age": "crosstab axis; summing gives the marginal total per "
                   "coverage type across all age bands",
            "Kaiser Health Coverage": "a parallel re-coding of the same "
                                      "coverage universe; summing it returns "
                                      "each Health Coverage member's own total",
        },
    ),
)

#: Deliberately excluded from v1: ``acs_ygl_language_spoken_at_home_*``. It
#: returns rows whose measure is ``null`` unless English Ability is also
#: drilled, which turns one metric into a two-dimensional table for little
#: reportable value. Left out rather than shipped returning blanks.

METRICS_BY_KEY: dict[str, Metric] = {m.key: m for m in METRICS}

#: Geography levels used for the two benchmark rails. Every headline metric is
#: fetched for the place, its parent state, and the nation in the same fan-out,
#: because "$80,269" only means something next to "$85,086 statewide".
BENCHMARK_LEVELS = ("State", "Nation")

#: Cube used to resolve a "City, ST" string to a Place ID. Any cube with a
#: populated Place level works; this one is already fetched for population.
PLACE_LOOKUP_CUBE = "acs_ygr_race_with_hispanic_5"


def metrics_for_section(section: str) -> tuple[Metric, ...]:
    """Every metric in ``section``, in manifest order."""
    return tuple(m for m in METRICS if m.section == section)


def headline_metrics() -> tuple[Metric, ...]:
    """The metrics that earn a slot in the masthead stat strip."""
    return tuple(m for m in METRICS if m.headline)


def unique_queries() -> tuple[tuple[str, tuple[str, ...], str], ...]:
    """The distinct ``(cube, drilldowns, measure)`` triples the manifest needs.

    Several metrics share one query — ``population``/``race`` both read the race
    cube, ``homeownership_rate``/``tenure`` both read tenure. De-duplicating
    here is what keeps a full city load to ~15 HTTP requests instead of 21.
    """
    seen: dict[tuple[str, tuple[str, ...], str], None] = {}
    for m in METRICS:
        seen[(m.cube, m.drilldowns, m.measure)] = None
    return tuple(seen)
