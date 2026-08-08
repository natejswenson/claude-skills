# Answering from retrieved facts

`ask` returns one of three shapes. Each has exactly one correct response, and
the difference between them is the whole skill.

## 1. Ranked facts

Answer from them. Cite `file:line` for anything load-bearing — the user's next
move is usually to open it. Name which skill the answer is about, because a
scoped question and an unscoped one look identical once the answer is written.

Say only what the facts say. If four facts cover the question and a fifth thing
is needed to make the answer useful, that fifth thing is **not documented**, and
saying so is more valuable than smoothing over it.

## 2. `SECTION LISTING`

The question named a skill and a section but no term matched — "what commands
does press have" contains no word that `node bin/press.js emit` literally holds.
The whole section is returned.

**Say that it is a listing.** It is every command press has, not the command
that answers a specific need. Presenting a listing as a targeted answer is a
quiet accuracy failure: the retrieval never claimed relevance, and the answer
does.

## 3. `NOT DOCUMENTED`

Relay it. The block already names the question, the scope, the terms, how many
skills and facts were searched, and the nearest sub-floor matches.

**Do not answer anyway.** Not from the conversation, not from having read the
skill earlier, not from the repo. The user can already ask a general question
and get a general answer; what they cannot get anywhere else is a *checkable*
one. An answer that mixes remembered context with cited facts is worse than no
answer, because it is no longer checkable and still looks like it is.

What to offer instead, in one line: reading the source directly, or — if the
gap is real and worth closing — that the skill's own docs should say it.

## Why the floor is on content, not on rank

`ask` computes two numbers. `base` is content match only: how much of the
question's substance a fact actually contains. `rank` adds section affinity and
a bonus for naming a skill. **Only `base` is compared against the floor.**

This is not a tuning detail, it is the one rule expressed as arithmetic. When
they were conflated, *"what is the retry limit in gmailtriage"* scored 10 and
returned five confident facts about gmailtriage, none of which mentioned a retry
limit — because naming the skill was worth +3, and a skill's own name appears in
nearly every line of its own card. The index has no answer to that question. A
bonus must never be able to lift a fact over the floor on its own.

For the same reason, a skill's name is stripped from the content terms. It is a
routing signal — it scopes the search, and the scope is disclosed — never
evidence that a fact answers anything.

## When the question is ambiguous

If the phrasing spans two skills ("how do I cut a release" — release? shipflow?
skillfactory?), ask which. One line, with the candidates named. Do not answer
for all three and let the user sort it out, and do not pick one silently.

## When a card is thin

If `ask` returns little because the section is nearly empty, say that the skill
does not document it, rather than stretching two facts into a paragraph. `build`
already reports thin cards; a thin card is a fact about the skill, and it is
usually the more useful thing to tell the user.
