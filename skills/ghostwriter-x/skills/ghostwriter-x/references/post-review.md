# Review before showing a post

Read this for every new draft and revision. The user sees only a draft that
passes all checks. Do not paste excerpts, put unreviewed copy in a picker, open
the draft in an editor, or offer a failed candidate as an option. Topic menus
can describe an angle and evidence; a proposed hook or post excerpt is draft
copy and needs this review first. Status updates describe the work without
quoting the candidate. A saved draft is private working material, not approval.

## The review loop

1. Read the current request, voice notes, voice profile, and 2–3 actual approved
   posts from the user's corpus. Use user-provided samples when the corpus is
   unavailable. Do not label bundled examples as the user's voice. If neither
   exists, ask for the missing voice evidence without showing the candidate.
   Keep current corrections above older samples. Read the source sidecar and
   the actual evidence for each claim, including the first-person anchor.
   Read any user-supplied critique as evidence about that evaluated version.
   Map it to exact passages before revising; a category score without excerpts
   does not tell you which sentence caused it. Do not infer authorship or aim
   for a zero score by flattening the user's voice.
2. Save the draft and finish Generate step 6's source check. Prepare its record:

   ```sh
   python3 scripts/post_review.py prepare --file drafts/<slug>.md \
     --voice ~/.claude/ghostwriter/voice/voice-notes.md \
     --voice ~/.claude/ghostwriter/voice/voice-profile.md \
     --samples data/my_posts.md
   ```

   For X, use `~/.claude/ghostwriter-x/voice/` and the actual extracted tweet
   corpus path. All scripts resolve from the loaded skill directory. Explicit
   paths can point at user-provided voice/sample files. The command creates
   `<slug>.review.json` with pending checks, current findings, and hashes of the
   draft, source sidecar, and context files. Preparing again resets the review.
3. Use one fresh editor subagent when the host supports delegation. Give it the
   exact draft, current request, rubric, voice files, real samples and source
   evidence, without the writer's defense or prior scores. It returns findings
   and the check record privately; the writer revises and the editor rechecks.
   Keep this to one editor and the three-round limit below. When delegation is
   unavailable, perform a distinct in-session editorial pass and label it
   honestly; do not claim independent review.
   Read the draft aloud mentally as a whole, then line by line beside the real
   samples. Apply every rubric row
   below, including to each tweet and the thread as a whole. Record each
   check as `{"status":"pass","quote":"<exact excerpt>","reason":"<specific evidence>"}`
   only after doing that check. Failures remain `fail` or `pending`. A generic
   “sounds good” repeated across rows is not evidence. For voice, identify the
   real samples and the cadence/register comparison in the reason; for
   credibility, identify sources and the supplied first-person evidence.
   Mark `reviewer` as `session-editor` for an in-session editorial pass or
   `independent-editor` only when a separate reviewer actually did the work.
   This works on Claude and Codex without paid API calls or a particular CLI.
   Never substitute an unavailable, skipped, or mock judge for the review.
   Complete both private comparisons described below. A draft can avoid every
   banned phrase and still lose to a clearer opening or a more focused edit.
4. Fix every hard finding. Inspect every warning in context. Remove the weak
   phrasing, or record `{"decision":"keep","reason":"<why this occurrence fits this voice and meaning>"}`
   against that warning's ID. Quoted criticism, code, genuine gratitude, or a
   necessary question can justify a warning; “the score is high” cannot.
   Hard failures cannot be waived through the review record. Never replace a
   banned word with a synonym while retaining the same canned sentence.
5. Revise privately and **re-run the gate after every edit**: prepare a fresh
   record and repeat the full review. Refresh sources when claims change.
   Allow up to three revision rounds; if still blocked, report the missing
   evidence or unresolved quality issue without exposing the failed text.
   Do not relax thresholds, manufacture detail, or use a bypass to finish.
6. Run `python3 scripts/post_review.py check --file drafts/<slug>.md --show`.
   Only exit 0 permits showing the exact draft in the host's approval view.
   The command validates the review against current files, reruns mechanical
   checks and the source gate, then emits the post. Any failed check withholds
   the text. Never infer a pass from a prior run or a manually written summary.

The report verifies review completeness and unchanged inputs. It cannot prove
that the editor's judgment is correct or certify “human-written.” There is no
AI-detection percentage, reach prediction, or overall score that can cancel a
failed dimension. The legacy `ai_tells.py --judge` / `evals/voice_judge.py`
commands remain optional diagnostics; mock scores never count as review.

## Compose before polishing

Use this during drafting, not just at the final gate:

- State privately the one thing this reader should understand and the real
  detail that makes it worth sharing. Lead with that situation or observation.
  A personal update can stand on its own; do not turn every experience into
  advice, a framework, or a request for replies.
- Start with a plain account in the author's register before trying a clever
  hook. Give technical details a job in that account. Remove a feature that
  starts a second topic rather than earning the first point.
- Prefer a concrete actor, action and consequence to vague claims of impact.
  Trace product behavior through its conditions and fallback/error paths in
  the evidence. Keep a condition that changes the meaning; an implementation
  detail that does not help the reader can stay out. Never invent a scene,
  feeling, metric, or run of the product to make the account warmer.
- Test questions wherever they appear, including the opener. Identify whether
  each asks for information the author actually wants, frames an explanation,
  quotes someone, or solicits attention. An explanatory question is allowed
  when it improves comprehension over stating its answer. A specific genuine
  question need not be removed. An answer already supplied by the post is not
  evidence that the author wants reader answers.
- Remove redundant setup and conclusions while preserving meaning and warmth.
  Plain does not mean clipped, cold, or artificially short. Read the whole post
  again: several mild devices (a teasing opener, dramatic line breaks, inflated
  stakes, then a soft ask) can add up to a manufactured performance even if
  each seems defensible in isolation.

## Two private comparisons before a pass

The editor tests the final candidate against plausible improvements, using the
same evidence and voice. Record both under `comparisons` in `.review.json`:

| Key | Required comparison |
| --- | --- |
| `opening` | Quote the exact opening. Write one viable alternative that leads directly with the real point; if the current opening already does that, try a different plain opening. Compare clarity, warmth and whether the answer is delayed. Keep the better wording and explain the concrete tradeoff. |
| `compression` | Quote the weakest or least necessary passage, not the strongest sentence. Try deleting it (`alternative: "[delete]"`) or write a tighter version. Explain what would be lost by that change: a necessary fact, qualification, connection or recognizably personal voice. If nothing useful is lost, revise before passing. A short post may already need every sentence; give evidence rather than forcing a cut. |

Each entry uses `{"status":"pass","quote":"<exact current excerpt>",
"alternative":"<different candidate or [delete] for compression>",
"reason":"<why the current version is stronger>"}`. Do not use a deliberately
bad alternative or generic praise to justify the current text. If an alternative
wins, revise, prepare a fresh record, and recheck the full draft. These are
editorial judgments, not an automatic ranking model. Alternatives stay private.
Old version-1 records require a fresh review; adding fields to an old pass is
not a substitute for doing the new comparisons.

## Editorial rubric: every row must pass

| Check | Pass only when |
| --- | --- |
| `voice` | The vocabulary, warmth, humor, rhythm and level of formality fit the user's actual samples and latest corrections. Identify a concrete conversational movement or human stance in the complete draft and compare it with the samples; first-person pronouns and short paragraphs alone do not establish warmth. Do not force a joke, feeling, or anecdote. Removing banned words alone does not pass an impersonal incident report or polished essay. |
| `naturalness` | Read-aloud flow is natural. No canned opener, manufactured contrast, repeated three-part cadence, ornamental fragments, symmetry slogan, stock transition, inflated verb, or robotic paragraph pattern remains. Contractions and sentence variety fit the author; never add typos or random slang to simulate humanity. |
| `substance` | There is one identifiable point and a real detail, observation, example or useful consequence supporting it. A reader gains something specific. Personal and humorous posts can offer recognition or delight; they need no fake checklist. A caption can rely on an actual supplied visual, never a promised future image. |
| `clarity` | The subject, action and consequence are understandable on first read. Cut throat-clearing, repeated claims, empty abstractions and unnecessary jargon. The deletion comparison identifies why the weakest remaining passage earns its space. Technical terms remain when they help the intended reader; tighter copy must preserve warmth and qualifications. |
| `hook` | The opening gives a concrete situation or tension and the rest delivers on it. It survives comparison with a direct opening; a question cannot just delay the answer. No exaggerated stakes, curiosity gap, generic announcement or buried point. LinkedIn's first ~210 characters make sense; X's first tweet stands alone. Never force a numerical hook against the user's warm register. |
| `ending` | The post stops on the last real point. No recap of what the reader just read, motivational slogan, tidy moral, self-promotion tacked on, or reflexive question. A real question is specific and one the author actually wants answered. |
| `credibility` | Every factual assertion, number, quote, comparison and first-person detail is supported; uncertainty and limitations survive editing. Check conditions, thresholds and fallback/error behavior before making an unconditional product claim. No invented chronology, emotion, user experience or broad claim smuggled into a personal anecdote. Source liveness alone does not establish support. |
| `restraint` | No engagement bait, humblebrag disguised as gratitude, credential flex, manufactured vulnerability, triumph arc, exaggerated certainty or inflated importance. Check every question's purpose and the cumulative effect of mild attention devices across the whole post. Its value survives without replies, likes or admiration. Honest achievement, gratitude and difficult experiences remain welcome when true and in the user's voice. |
| `originality` | The angle and wording belong to this person and situation, not any interchangeable account. Compare recent samples for repeated hooks, arcs and closers. Avoid copying source phrasing or recycling the same lesson; don't contort an honest update just to seem novel. |
| `platform_fit` | The final copy fits the requested format and current voice habits: readable spacing, intentional emoji/hashtags, no accidental markdown or placeholders. LinkedIn obeys its character limit; each X tweet passes weighted counting and earns its place. No automatic thread expansion or unnecessary padding. |

Mechanical warnings are prompts for judgment, not authorship evidence. A short
paragraph, em dash in a quote, or use of a number does not establish that a post
was AI-generated. Existing hard voice bans still apply; ask the user about a
true conflict rather than silently overriding their preferences.
`question_purpose` flags every question for a contextual decision, including
quoted questions and literal question marks in technical text. A keep reason
must identify its role and value here; the warning does not ban questions.

## Showing, editing and publishing

After a pass, use the skill's complete draft display and approval flow. Add only
`Review passed · voice, substance, clarity, credibility and platform checks`.
Keep raw reports and rejected versions local. Passing review is not permission
to publish. A changed word, claim, thread order, or final reply requires a fresh
review and approval. When a visual changes the body, run the entire loop again;
review image text and alt text for the same editorial defects before showing them.

Both publishers require a current passing `.review.json` before dry-run payload display, media upload or
external draft creation. Existing source/AI override flags do not bypass this
review. An old approved draft without a record must be reviewed before reuse.

## Reference and adaptation

Reviewed [yourpost.sucks](https://yourpost.sucks/) and its linked
[public code](https://github.com/cruce5/yourpost.sucks) on 2026-09-20. Its checks
cover stock announcements, excessive gratitude, emoji, humblebrags, engagement
bait, performative vulnerability, structural habits, AI-style phrasing, clarity,
repetition and promotional endings. It separates deterministic scoring from
model commentary and accommodates captions with media. These informed the
review categories above; this is our own rubric and implementation, not its
engine or score. No draft is sent to that service. The user's voice and evidence
take precedence over generic style heuristics.
