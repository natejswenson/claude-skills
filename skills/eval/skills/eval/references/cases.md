# Cases — a finding made permanent

A finding is an observation about one run. It evaporates: the run ends, the
transcript scrolls away, and the same mistake is available to be made again next
week. A case is that observation turned into a test that will keep failing until
somebody fixes the thing.

## The only way to know a case is worth keeping

Watch it fail.

`eval case` writes the test into the target skill, runs that skill's own
runner on it, and **deletes the file and exits non-zero if it passed**. There is
no flag to keep a green case, because the alternative is a folder of assertions
that have never once been observed failing — every one of which could be
asserting nothing at all.

That is not hypothetical. It is the exact failure this repo has already had: a
`r.errors ?? []` typo against a `{ok, findings}` return let 61 devlog entries
report "all clean" while checking nothing. Generating cases automatically is the
fastest way to manufacture that failure at scale, so generation is welded to
proof.

## What a case asserts

A string that must be **absent** from a committed file in the target skill.

```
eval case --skill skillfactory --in SKILL.md --prove \
  --assert-absent "the exact text that is the defect" \
  --finding f-987e589e --clause press-13f05150 --event e126
```

The generated test reads that file and asserts the string is gone. It is red on
the day it is written — that is what `--prove` confirms — and it goes green the
day the defect is fixed. Write-the-failing-test-first, applied to a contract.

## Why the assertion is supplied, not derived

Deriving "what should change" from a finding is judgment, and it is the part of
this skill a machine is worst at. The finding says *a run piped output through
awk, breaking the one-script-call clause*. Whether the fix is to edit the
skill's instructions, to add a flag to a script, or to accept that this run was
simply careless — nothing on disk answers that.

So the split is: the model decides what should be absent and from which file;
the machine proves that it is present today. Each half does the thing it can
actually be held to.

## When a case is refused

| Refusal | Why |
|---|---|
| green on arrival | never observed failing, so it proves nothing |
| `--prove` omitted | a case that has not been run has not been observed |
| `--assert-absent` under 8 characters | a short substring matches by accident, and an accidental match is a false red that teaches people to delete cases |
| a python skill | only node cases are generated today, and emitting an unproven python case would be exactly the decoration this command exists to prevent |

## Which findings deserve a case

Most do not. A case is worth its permanence only when the failure class will
**recur** — when the defect lives in a committed instruction, script or template
that will produce the same mistake for the next person.

A one-off slip in a single run does not earn a permanent test. It earns a
sentence in the report and nothing more. Keeping the bar there is what stops the
generated folder from becoming noise nobody reads, which is the second way an
eval suite dies.
