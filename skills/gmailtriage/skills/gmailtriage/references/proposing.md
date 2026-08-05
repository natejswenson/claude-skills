# How a first run proposes rules

The skill ships **no default rules**. A rule pack written by someone who has
never seen your mail makes the first run the riskiest one, which is backwards.

Instead `propose` reads a real slice of the inbox, clusters it by sender, and
returns candidates drawn from *your* senders — with the count in the sample and
an example subject, so each one can be judged on evidence rather than on a
promise.

```
gmailtriage propose --threads threads.json --out candidates.json
```

It proposes only. It writes no rule and trashes nothing. Accept what you want
with `rules --add`, and the accepted rules are yours from that moment.

## What a candidate needs

- at least `--min-count` threads in the sample (3 by default)
- at least one carrying a bulk-mail marker
- a sender that is not on the withheld list (see `safety.md`)

## The clusters it deliberately never proposes

Read `safety.md` for the full table. The one worth repeating: **a sender that
ever delivered a login code is withheld entirely**, however much marketing it
also sends. Bulk and important are not mutually exclusive, and the sender that
mixes them is the one that costs you.

## Reading the withheld table

`propose` prints what it *declined* to propose and why. That table is the
interesting half: it is where you find the sender you actually wanted a rule
for, and can write one by hand knowing exactly why the skill would not.

A withheld sender is not a forbidden one. The guards constrain what the skill
suggests, never what you are allowed to decide.
