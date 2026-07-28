---
title: "Grading a workout without failing every easy day"
date: 2026-07-20
project: local-fitness
version: v0.25.0
tags: [scoring, rubric-design, product-design, median, robust-statistics, python, llm, pytest]
summary: "Any system that grades a user against their own history hits the same wall: the naive rubric punishes the behavior you asked for. Four design decisions fix it, and a real graded report card shows what each one is worth."
---

## Shipped

This release added a graded report card for a single workout. Four metrics, letter
grades, an overall, and a written read on top. Before it, my fitness agent could
describe a run but never judge one, so the same workout got called "solid" one day
and "flat" the next depending on how the model felt.

Here is a real card, for a real run:

![A generated report card: overall grade B for a 3.06 mile run, with distance A, pace C, average heart rate A+, and training load A, plus a per-mile table and a heart-rate chart.](/devlog-assets/local-fitness/v0.25.0-report-card.png)

The grading is plain Python, not model output. The model gets the four paragraphs
at the top and is told the letters are not its to revise. That division is the easy
part to agree with. The hard part is the rubric itself, and the decisions behind it
transfer to anything that scores a user against their own past: a reading streak,
a support queue, a spend budget. That is what this post is about, so it stays on
the decisions rather than walking you through building a fitness app.

## Read the card before reading the code

Look at the pace row. The plan prescribed 10:28 per mile; the run came in at 9:28.
A full minute per mile faster, and it scores a **C** while the heart rate row scores
an A+.

That combination is the entire design problem in one screenshot. A naive rubric
would have done the opposite on both counts. It would have rewarded running faster,
because faster is better in almost every system anyone has ever built. And it would
have punished a heart rate below the runner's norm, because lower is better right
up until it isn't.

Both instincts are wrong here, for the same reason: **the expected behavior was not
"maximize."** It was "stay easy." Distance from normal is not the same thing as
failure, and a rubric that cannot tell them apart will fail every deliberate
deviation you ever asked a user to make.

## Decision 1: collapse every metric to one number

The temptation with four metrics is four scoring functions. Resist it. Reduce each
metric to a single non-negative relative deviation, then push all of them through
one shared band table.

```python
GRADE_BANDS = ((0.05, "A"), (0.10, "B"), (0.20, "C"), (0.35, "D"))


def grade_from_deviation(d, widen=1.0):
    """One deviation to one letter. `widen` scales every boundary at once:
    above 1.0 for a loose reference, below 1.0 for an explicit instruction."""
    if d is None:
        return None          # ungradeable stays out of the average entirely
    d = max(0.0, float(d))
    for threshold, letter in GRADE_BANDS:
        if d <= threshold * widen + 1e-9:
            return letter
    return "F"
```

Four deviation functions and one grader means the rubric has exactly one place where
strictness lives. When a grade looks wrong, you are debugging one table, not four
scattered thresholds that drifted apart over six months.

The `widen` parameter is doing more work than it looks. It is the seam that lets one
table serve expectations of very different confidence, which turns out to matter a
lot. More on that in decision 3.

`None` propagating through is the other quiet load-bearing bit. A metric you cannot
grade must be *absent* from the average, not zero. Renormalize by the weights you
actually used, or a missing heart rate reading silently drags a good workout down.

## Decision 2: gate the deviation by direction

This is the one that rescues the easy run, and it is three lines.

```python
def pace_deviation(actual, expected, intent):
    """Pace is seconds per mile, so LOWER is faster."""
    if intent in ("easy", "long"):
        return max(0.0, (expected - actual) / expected)   # only too FAST costs
    if intent == "quality":
        return max(0.0, (actual - expected) / expected)   # only too SLOW costs
    return abs(actual / expected - 1.0)                   # no stated intent
```

An easy day is penalized for being too fast and never for being too slow. A tempo
day is the mirror image. Anything without a stated intent falls back to a two-sided
comparison with deliberately wider bands, because you are guessing.

The general form: **before you can grade a deviation you have to know which
direction was the point.** Most scoring systems skip this because most metrics look
like "more is better," and then they quietly punish exactly the restraint they were
built to encourage. If your product ever tells a user to slow down, spend less, or
close fewer tickets on purpose, an absolute-difference rubric will grade that
instruction as a failure.

Note the same logic on the card's other rows. Distance is one-sided against the
rolling median, because running longer than usual is never a penalty, but two-sided
against a plan, because a 12-miler on a 10-mile prescription is overcooking it.
Heart rate is graded against a *range* rather than a point, which is why its row
reads "in range" instead of a percentage.

## Decision 3: pick a reference, then say which one you used

Every expectation needs a source, and there are only two honest ones: something the
user was told to do, or something the user typically does. The card names its source
on every row. Distance and pace here say `plan`; heart rate and load fall back to a
60-day rolling median, because the plan has no column for them.

Three rules make that fallback trustworthy.

**Use the median, not the mean.** Python's own docs are blunt that the mean ["is
strongly affected by outliers"](https://docs.python.org/3/library/statistics.html)
while the median ["is a robust measure of central location."](https://docs.python.org/3/library/statistics.html)
NIST's handbook explains the mechanism in a sentence: ["Extreme values in the tails
distort the mean. However, these extreme values do not distort the median since the
median is based on ranks."](https://www.itl.nist.gov/div898/handbook/eda/section3/eda351.htm)
Every real activity history contains a race, a sensor fault, or a once-a-year
effort, and each one drags a mean.

**Refuse to grade on a thin reference.** Under five comparable activities, the card
returns n/a and says so. Grading against two data points is worse than not grading,
because a letter looks equally authoritative either way.

**Only compare like with like.** More on that in the gotchas; it is where I got this
most wrong.

And the tightening rule from decision 1 lands here. **A plan target is an
instruction; a rolling median is a reference.** They are both just an expected value
in code, which makes it natural to grade them identically, but they carry completely
different confidence. So plan-referenced bands are scaled by 0.6.

You can check that arithmetic against the card. Sixty seconds against a 628-second
target is a 9.6% deviation. Under the plain bands that sits inside B, near the
bottom of it; the real grader adds a +/- for position within a band, so it renders
B-. Tightened for a prescription the same deviation crosses into C, which is what
the card shows. That one multiplier is the difference between a card that says B-
and hands out an overall A, and a card that says C, which is the honest verdict for
a prescribed easy run executed a minute per mile too hot.

## Decision 4: display the number you actually graded against

Look at the heart rate row: actual 136, expected "≤ 142 bpm", delta "in range."

An earlier version printed the bare rolling median in that column instead. A run at
136 against a 146 median rendered as "-7%" sitting next to a B+, when the real
finding was that it sat 6% *above* the ceiling that produced the grade. Every number
in the row was individually true and the row as a whole was incoherent.

If a metric is judged against a band, the band is what goes in the expected column.
This is the cheapest correctness check you can build into a scoring UI: **a user
must be able to recompute your grade from the numbers you showed them.** If they
can't, the grade reads as a black box no matter how principled the code behind it is.

## Gotchas

**Pooling incomparable categories poisons the reference.** My first version pooled
all running together. Treadmill and road are different heart rate regimes, and on
live data the mixed pool put median heart rate at 119 against an outdoor average
near 140, which handed a perfectly normal easy outdoor run a D. The rubric was
reporting an artifact of the pool, not a judgment. Symptom: a grade that moves when
unrelated activity is added to the history, with no change to the graded item. The
escape is exact-category first, widening only when that pool is too thin, and saying
on the card when it widened.

**Bands calibrated on intuition rather than on your distribution.** My original
easy-heart-rate ceiling was 0.88 of the median, which sounds reasonable and was
unreachable. The reference median is taken over all comparable activity, and for a
runner whose training is mostly easy, that median already sits near easy heart rate.
Demanding 12% below it asked for a number that appeared in 1 of 13 runs in the
window, and the one that qualified looks like a sensor fault. Heart rate became a
standing penalty rather than a judgment. Before changing a bound, check what
fraction of real history clears it. If the answer is "almost none," you wrote a
constant, not a criterion.

**A card that contradicts its own coaching text.** Before the plan-tightening rule,
this same run scored an overall A while the written read said the runner never ran
easy at all. Two subsystems, one computing grades and one describing them, disagreeing
in public. Worth building a check for whenever a generated summary sits next to
generated numbers.

**Grade only what you can grade for everyone.** The per-mile table on the card is
presentation, not input; no grade reads it. Only 87 of 747 activities in my database
have per-lap splits, because the daily sync writes them and the historical backfill
never did. A splits-dependent grade would be unavailable on 88% of history and would
quietly mean different things on different rows. Same for the heart rate trace under
the chart, which is fetched on demand for one activity rather than backfilled.

**Adding an LLM to a tool will put your test suite on the network.** The read at the
top of the card is a model call, and every render generates one, so the moment tests
rendered a card they were making real API calls. The suite went from 10 seconds to 7
minutes, cost real money, and stayed green throughout, which is why nobody noticed.
Block it at the choke point with an autouse fixture, the same shape pytest's own docs
use to remove `requests.sessions.Session.request` so ["any attempts within tests to
create http requests will fail"](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):

```python
@pytest.fixture(autouse=True)
def _no_live_model_calls(monkeypatch):
    """Patch the single SDK entrypoint every generator funnels through, so a
    module added next month inherits this without anyone wiring it up."""
    import my_llm_sdk

    def _blocked(*args, **kwargs):
        raise RuntimeError("Live model call in a test. Patch the generator.")

    monkeypatch.setattr(my_llm_sdk, "query", _blocked)
```

Two things make it work. Patch the one entrypoint rather than each call site. And
make sure callers degrade to a deterministic fallback, so the raise becomes the
offline path and the default test run exercises it. An autouse fixture is one that
[all tests automatically request](https://docs.pytest.org/en/stable/how-to/fixtures.html)
without naming it, and in a `conftest.py` it covers every test in that directory and
below.

## Sources

- [`statistics` module, Python docs](https://docs.python.org/3/library/statistics.html) — the median as a robust measure of central location versus the mean's sensitivity to outliers.
- [Measures of location, NIST/SEMATECH e-Handbook of Statistical Methods](https://www.itl.nist.gov/div898/handbook/eda/section3/eda351.htm) — why extreme values distort the mean but not a rank-based statistic.
- [monkeypatch, pytest docs](https://docs.pytest.org/en/stable/how-to/monkeypatch.html) — the autouse-fixture pattern for blocking remote calls across a suite.
- [Fixtures, pytest docs](https://docs.pytest.org/en/stable/how-to/fixtures.html) — how `autouse=True` reaches every test in a directory tree.

## Changelog

- feat: workout_report_card — graded per-workout report card with coach read and HR/pace chart (0.25.0) (#125) (#126) ([724a1ab](https://github.com/natejswenson/local-fitness/commit/724a1abca6ac276ae891a06a97bd19af4bb8f84f))
