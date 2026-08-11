# The blind discovery

The user supplies a name and nothing else. The search plan is judgment — no
file records where a person exists online — but it follows a shape.

## Round 1 — seed from the bare name

Search the name plain, the name in quotes, and the name plus the obvious
disambiguators the first results suggest (a city, an employer, a field).
Web search and page fetches go through whatever search/scrape tools the
session has; brandreport itself never touches the network.

## Round 2 — widen from what round 1 anchored

The first confirmed artifact is the **anchor** — usually a profile the person
plainly controls (a GitHub account, a personal site). Everything it links to
is a lead: handles reused elsewhere, a site in a bio, a company page. Search
each handle and each linked domain by name. This is where most of the real
presence is found — people link themselves together far more than strangers do.

## Round 3 — the handle sweep. Mandatory, not optional

Take every handle the anchor uses anywhere — the domain, the GitHub login,
the npm scope, any slug a bio or package points at — and probe it on each
major platform **by URL**, whether or not search ever surfaced it:

```
x.com/<handle>          linkedin.com/in/<handle>     github.com/<handle>
npmjs.com/~<handle>     medium.com/@<handle>         youtube.com/@<handle>
reddit.com/user/<handle> instagram.com/<handle>
```

Search engines index walled platforms badly: the first real run of this skill
missed both `linkedin.com/in/natejswenson` and `x.com/natejswenson` — the
subject's own accounts, under the anchor handle itself — because it relied on
what search returned and never swept the handle. The LinkedIn slug was even
sitting in a round-1 result URL (`linkedin.com/posts/<handle>_…`) unread.

For a platform that blocks logged-out reading, work outward:

- search the slug's public-post URL shapes (`linkedin.com/posts/<handle>_`) —
  post titles and blurbs are indexed even when the profile is not
- if the subject is the user running this skill, their own authenticated
  session tools (an X scheduler, a connected MCP) can prove ownership —
  record that as the corroboration, honestly out-of-band
- treat empty success as nothing: an endpoint answering HTTP 200 with an
  empty body has not confirmed absence any more than presence

A walled account whose existence is proven gets an **existence-only
snapshot**: the artifact records how it was probed and what tied it, claims
nothing about content, and the report's gaps say the content is invisible to
a logged-out stranger. Only an account no probe can even prove exists is
reported as absent.

## Corroboration — the judgment the gate audits

A hit is **confirmed** only by a signal you can write down in one sentence:

- a cross-link (the anchor links to it, or it links to the anchor)
- a shared handle (`natejswenson` on two platforms is the same person until
  the content says otherwise — say which content you checked)
- a bio match specific enough to exclude strangers (employer + city + field,
  not "software engineer")

That sentence goes in `add --corroboration`. If you cannot write it, the hit
is `--status unconfirmed --why "<what was missing>"` — filed, listed in the
report's residue section, and never cited by a claim. Same-name strangers are
the expected case, not an edge case: a bare name search mostly finds people
who are not the subject.

## When to stop

Never before the handle sweep has run — a corpus with no row for each swept
platform (found, existence-only, or ruled absent) is not coverage, it is
whatever the search engine happened to index. After that: stop widening when
a full round produces no new confirmed artifact and no new
lead — not when the corpus "feels" complete. Then file what the last round
left unconfirmed, write `findings.json`, and run `gate` before `report`.

## What never happens

- No fetching behind a login, no scraping a platform that blocks it — a
  presence that cannot be fetched is reported as a gap, not guessed at.
- No claim sourced to memory of a page; if it mattered, it was snapshotted.
- Nothing about private individuals who merely appear near the subject —
  the report is about the subject, and strangers stay out of the corpus
  except as anonymous unconfirmed residue.
