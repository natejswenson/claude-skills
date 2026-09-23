# Ghostwriter's Codex session UI

## Request

Exercise local-dev on a real feature: improve ghostwriter's UI inside Codex.
The user selected **the whole flow: clearer choices, progress, and previews**.
This is a skill implementation task, not a request to create or publish a post.

## Acceptance criteria

- Codex uses an available, mode- and purpose-eligible native selector for ordinary
  choices, respecting the tool's actual schema and option limits. Publication
  approval and artifact views use normal replies when required by host/tool limits.
- Open-ended posting starts with the existing Project / Trends in Industry /
  Personal Fun lanes. A supplied topic bypasses those questions. Custom topics,
  stable idea IDs, more/fewer, status labels and exit remain available.
- Stage changes and slow work provide concise progress; no duplicated menus,
  raw execution output or claims to control native tool-card visibility.
- A reviewed draft is fully readable, including everything below the fold;
  edits show the change and the full latest revision. Failed reviews stay private.
- Text approval, visual selection and image approval have clear meanings.
  Codex says **Approve text** at the text stage and **Publish now** only when
  the complete final text and selected media are visible together.
- An already-complete text-only payload goes directly to one final decision,
  without a redundant text-approval step. Timing/cadence recommendations and any
  necessary engagement question precede that final decision.
- The final payload includes image alt text or the carousel title and access to
  every slide. A changed bound text/media field requires current review/approval.
- No preselection, silence, topic choice, format choice or stale response can
  authorize publication. Stop/edit requests invalidate pending choices.
- Claude's working controls and current publishing/quality checks remain intact.

## Scope and decisions

Keep this a focused change to the skill's session instructions, supporting UI
reference, README, contract coverage and help index. Use the tools the host
actually exposes; no terminal emulator, browser dashboard, new runtime daemon or
second publication system. Do not read private voice files, credentials or posts,
generate an image, or publish to LinkedIn during this development test.

Use a dedicated branch `feature/ghostwriter-codex-ui` from cached `origin/main`
(`0b475a5`). Remote freshness is unverified until final delivery. The original
checkout's visual-quality branch and scratch files are separate work.

## Repository evidence

- `skills/ghostwriter/skills/ghostwriter/SKILL.md`, Run presentation, bans Codex
  asynchronous selectors based on a September 11 failure. The current user has
  successfully answered three native selectors in this local-dev session.
- Generate step 2 repeats the hard-coded inline route. Step 7 labels text
  approval Publish even though visual selection comes next. The guardrail footer
  repeats the old selector ban. These routes must change together.
- `references/codex-images.md` already requires actual reviewed pixels and a
  full-size viewer/link. Preserve this and give the image approval an explicit
  handoff to final payload review.
- PRESS owns the universal run envelope and native-control preference. The new
  reference supplies only ghostwriter's Codex stage behavior, not a copied brand
  contract. The curses radar remains for terminals with actual user keyboard input.
- `tests/test_skill_contract.py` reads `skill-invariants.json`; existing contracts
  pin full draft visibility, lane selection, source/voice review and image checks.

## Implementation

1. Add `references/codex-session-ui.md` as the single Codex interaction reference,
   with decision routing, stage views, text/visual/final approval distinctions,
   edit/stop/stale-response behavior and compact examples.
2. Route all Codex entrypoints to that reference; remove date-based selector bans
   and conflicting repeated instructions. Preserve the inline four-column fallback,
   user-attached radar and Claude behavior. Keep every actual question self-contained.
3. Make the text stage use Approve text / Edit / Save draft when media work follows.
   An already-complete text-only payload skips duplicate intermediate approval.
   Select/review media
   next unless already specified, then show the full final payload with Publish
   now / Edit / Save draft. Treat draft-only, local-only and stop requests as
   scope limits; never insert publication into a draft-only request. Move advisory
   timing/cadence/engagement work ahead of the final decision so Publish now does
   not introduce another routine gate.
4. Update README and prose invariants for the changed behavior. Use meaningful
   existing contract coverage for authorization and rendering requirements, plus
   independent scenario walkthroughs; do not add tests that merely mirror headings.
5. Rebuild the help index, run applicable local checks, commit implementation and
   verification separately from this plan, and open a draft PR targeting main.

## Validation

Run ghostwriter's required pytest/coverage suite and shellcheck, structural score,
plugin/baseline lint, combined host compatibility, generated-metadata drift,
PRESS checks and help-index tests. Use independent forward scenarios with supplied
synthetic inputs and mocked tool availability: native selectors, unavailable
selectors, a direct topic, an edited long draft, selected/no visual, cancellation
and stale reply, carousel visibility, draft-only termination and selector limits.
Report simulated behavior separately from actual user interactions.
No live account action is part of validation; the script-level source/editorial/
visual gates and existing offline publishing tests remain unchanged.

## Review

The independent local reviewer found four concrete gaps: tool eligibility needed
purpose/schema limits; existing publish advice could cause another prompt after
Publish now; text-only payloads would receive duplicate approval; and final media
visibility needed alt text/carousel title and every slide. All four corrections
are incorporated above. No other blockers were reported.
