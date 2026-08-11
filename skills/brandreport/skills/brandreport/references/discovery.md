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

Stop widening when a full round produces no new confirmed artifact and no new
lead — not when the corpus "feels" complete. Then file what the last round
left unconfirmed, write `findings.json`, and run `gate` before `report`.

## What never happens

- No fetching behind a login, no scraping a platform that blocks it — a
  presence that cannot be fetched is reported as a gap, not guessed at.
- No claim sourced to memory of a page; if it mattered, it was snapshotted.
- Nothing about private individuals who merely appear near the subject —
  the report is about the subject, and strangers stay out of the corpus
  except as anonymous unconfirmed residue.
