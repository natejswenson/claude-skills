# Ghostwriter in a Codex session

Read this at the start of a Codex run. PRESS owns the shared presentation rules;
this reference defines ghostwriter's choices and preview-to-publication flow.
Use the session's actual capabilities. Do not build a dashboard, open an HTML
radar, or launch an agent-owned terminal process as though the user can type in it.

## Choose the control by purpose

Use an available native selector for ordinary preferences such as lane, idea and
visual format. Check the current mode, tool purpose, schema and option limit;
never call a Plan-only tool in Default mode or use a preference-only tool to
request permission. In hosts with `request_user_input_async`, ordinary choices
can use its supported title/options fields. Do not invent a preview field or
assume another host's question schema works here.

Make each question self-contained: the choice, a short consequence, and any
signal needed to decide must be in the question/options themselves. Prefer up
to three useful options; use a fourth only when both the tool and PRESS allow
it. If fewer options fit, show fewer Ready ideas and reserve room for **More
ideas** when needed. Do not duplicate the same choices in a table and a native
selector. In lane/idea questions, explicitly offer custom input: **Type your
own topic, or reply “own topic.”** An automatic Other field alone is not enough.
For the lane question, keep the required interrogative verbatim at the start;
the title may continue with brief explanations and this custom-topic guidance.
Other stages offer only relevant custom input, such as a format preference or
an outcome number; do not insert topic navigation into an unrelated question.

If no eligible selector exists, the call is refused, or the user reports it is
not visible, use a numbered inline choice in the **final message** and wait for
a normal reply. Keep that fallback for this session instead of probing again.
An accepted asynchronous call means the question was submitted, not that the
user saw or answered it. Do not treat silence as failure, a choice or consent.

For **draft, image and publication approvals**, put the complete preview and
its action line together in the **final message**, then wait for a normal reply.
Do not put the artifact in commentary before a selector that may collapse it.
Use a native artifact-approval control only if it is permitted for that purpose
and demonstrably keeps the entire current artifact visible while choosing.
A link alone, a thumbnail alone or distant scrollback is not a complete preview.

Keep one pending decision. An answer belongs to the current stage and revision;
preselection, an old response and elapsed time never authorize the next action.
Honor already supplied topics, formats and actions without asking again.

## Stage views

Use one quiet stage label when the stage changes: `ghostwriter · ideas`,
`ghostwriter · draft`, `ghostwriter · visual`, `ghostwriter · publish`.
Status is one concrete sentence about the work or result. Slow research/review/
rendering gets a brief progress update while it runs; do not invent percentages,
turn every tool call into a status message, or print the private review rubric.
Tool-card visibility is host-owned; do not claim to hide cards you cannot control.

| Stage | Show | Next decision |
|---|---|---|
| Ideas: no topic | Ask “What type of post will you be writing today?” with Project, Trends in Industry, Personal Fun. Project means recent project work, not a promise of access to another host's history. | Choose the lane, then research only that lane. |
| Ideas: results | Up to three Ready ideas, each with its stable ID, title, angle and dated signal. Use plain status words for gaps. | Idea, More ideas when needed, own topic, or exit. |
| Draft | The full current reviewed text, fold indication, one compact metadata line and a useful draft link. An edit starts with `Changed: …`. | Approve text / Edit / Save draft when media work remains. |
| Visual: format | Only useful formats for this post, each with a concise description. Honor a format already supplied. | Choose once; generate/capture only the selected format. |
| Visual: result | Actual reviewed media, full-size access, current alt text or document title, and one sentence about a revision. | Approve card (or visual) / Change / Drop. This selects media; it does not publish. |
| Publish | The complete final post plus selected media and attachment details, or an explicit Text-only label. | Publish now / Edit / Save draft. |

A concrete topic bypasses both lane and idea selection. An ideas-only request
stops at the ideas; it does not trigger credentials, a draft or a publish dialog.
An explicitly draft-only/no-publish request stops with the requested reviewed
artifacts and an Edit / Save draft choice, never a Publish now action.
An outcome check-in, when due, follows idea selection; do not obscure the primary
choice with a second Codex question. It is optional context, not a setup obstacle.

**More/fewer:** reuse the saved board; do not rerun research just to navigate it.
For the expanded view, use the inline `# | Idea | Angle / signal | Status` table
with every saved row, including Watchlist/Stale. Keep IDs fixed. Only Ready IDs
can advance to drafting; explain any needed research for other selections.
“Fewer” returns to the compact native choices, or three rows in the inline
fallback. Keep the own-topic action visible in every view, including an empty
board. If all rows are unavailable, offer own topic or an explicit refresh;
never relabel a stale item Ready to fill a menu. Inline tables are static,
not controls that expand in place or intercept Codex keyboard shortcuts.

## Readable drafts and media

Run the existing source/editorial gate before exposing any draft copy. Show the
entire post in the skill's plain-text fenced block, preserving paragraph breaks.
The fold marker is presentation only: never save it into the post or pass it to
the publisher. Keep one line below it: word count, lane and `Review passed`.
A short draft needs no fold marker. Do not add an essay explaining the draft,
a second excerpt, a fake score or a table around the post. Explain an edit in
one `Changed: …` sentence and re-show the full reviewed revision.

Open the saved draft when supported, but keep the full text inline. If opening
fails, say so once and retain its actionable link and inline text. Never claim
an opener succeeded without observing it. **Save draft** keeps the current
files and ends this flow; it is not scheduling, publishing or deleting anything.

The existing image/visual review remains mandatory. Show the actual passing
image with its current **alt text** and provide full-size access using the
existing viewer/link fallback. Do not reduce that view to an image filename.
For a carousel, show every reviewed slide and its **document title**, with the
full PDF available; never approve from the cover alone. The final approval view
must contain all slides or an observed-open complete document alongside the
full post and a link. If neither is possible, keep it as a draft and disclose
what the user cannot yet inspect. Apply these views to native screenshots,
explicit legacy renders and carousels as well as generated cards, preserving
each route's existing checks.

Failed text or visual reviews stay private. Give one plain-language blocker
and a useful next action. Never offer Approve or Publish now for a failed,
unreviewed or stale candidate. UI feedback about menus/progress is not a writing
voice correction; do not save it to voice notes as if it described the post.

## One final publication decision

Approve text means the wording is settled so media work can proceed. Approve
card/visual means the selected media is settled. Neither authorizes an external
write. **Publish now** applies to the exact currently visible post, media,
alt text or document title. The posting scripts and quality gates remain the
execution path; this reference does not create a second approval system.

For an already-complete **text-only** payload, skip the intermediate Approve
text and format questions: show the full reviewed post and go directly to the
final decision. This also applies when the user already selected Text-only or
Drop card. Do not show the identical payload twice just to collect two approvals.
If the user already explicitly authorized this exact fully visible current
payload, retain that authority and proceed after current technical checks;
do not demand the label “Publish now” or ask the same question again. Approval
before a draft/attachment exists is not approval of that final payload.

Surface any timing/cadence advice and genuinely missing engagement information
from Publish step 0 **before** the final decision. Keep recommendations brief
and non-blocking; do not put an engagement questionnaire after Publish now.
A clear request to publish despite the advice is sufficient. Never schedule it
instead. When publishing is unavailable, say so and offer Save draft or the
specific setup/recovery step instead of presenting a working publish action.

After explicit approval, publish once with the existing scripts. Success shows
the observed post URL and a concise engagement reminder. An ambiguous failure
is not success or permission to retry blindly: report the uncertainty and
reconcile the result before another external write.

## Changes, interruptions and resume

Typed edits go straight to editing; do not make the user first choose Edit.
Changes to text, media, alt text or document title invalidate their previous
approval and require the applicable fresh review, complete preview and approval.
Re-show the final combination when a changed component would alter publication.
Keep unchanged components; do not restart topic selection or unrelated research.

Stop, exit, Save draft, or a request to edit the skill ends the current flow and
invalidates pending questions. A late selector response cannot revive it. If a
response refers ambiguously to an older revision, resolve that ambiguity without
publishing; never reinterpret an old Approve text as the new Publish now.

Resume from the latest saved artifacts and conversation decisions. Recheck
current review receipts and show the latest complete payload when approval is
needed. Preserve explicit prior authority only for the unchanged exact payload
and current intent; do not infer publication from a saved file or a passing gate.
