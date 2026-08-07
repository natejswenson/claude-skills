# dispatch — the prompt is the only channel

A subagent starts cold. It cannot see the conversation that dispatched it, the
files the orchestrator read, or any decision already made. Whatever is not in
its brief does not exist for it.

That makes the dispatch prompt the highest-variance part of a multi-agent run —
and, when it is improvised in the moment, the only part nobody reviews, because
it never lands on disk.

**So it lands on disk.** `issueflow brief` renders it from the run state and the
approved artifacts, writes it to `briefs/<step>.md`, and hands back a path. The
baseline eval byte-compares those files, which is how a brief that silently
stopped carrying the design gets caught by CI instead of by a confused subagent.

## What crosses

| In the brief | Why |
|---|---|
| who the subagent is, and that it is cold | it will otherwise assume shared context and ask questions nobody hears |
| the issue body and every comment, inlined | the ground truth, and the fix is often in the comments |
| the paths of every approved prior artifact | the decisions it inherits, with an instruction to read them first |
| the exact task, from the stage declaration | so two runs of the same stage are asked the same thing |
| what it must not do | every stage has one characteristic overreach |
| the branch, the base and the work item | it commits; it needs to know where |
| the artifact path and the sections the gate reads for | a stage that writes the wrong file has done nothing |

## What never crosses

- **The conversation.** If it mattered, it belongs in an artifact.
- **The orchestrator's opinion of the previous stage.** The artifact was
  approved; a commentary layer on top of it is a second, unreviewed source of
  truth.
- **Anything about the other lanes.** A work item that needs a sibling's context
  was not a separable work item, and the split was wrong.

## Why paths, not pasted text

Prior artifacts cross as paths with a mandatory "read these first" instruction,
not as inlined copies. A brief that copies its predecessor's prose creates a
second copy that drifts from the file the user actually approved. The subagent
can open a file; the file stays the single source.

The same reasoning governs how the brief itself reaches the subagent. The
dispatch prompt is one line:

```
Read <briefs/investigate.md> and follow it exactly. It is your complete brief.
```

Pasting the brief into the transcript would put a page of machine-generated
instructions in front of a user who has no reason to read it, and would make the
prompt something the orchestrator retyped rather than something the renderer
produced.

## The stage declaration is the contract

`scripts/lib/stages.mjs` holds each stage's model, agent type, artifact name,
`asks`, `forbids` and `requires`. Everything else reads it: the brief renderer,
the gate, the run board. A stage cannot drift between what it is told to do and
what it is checked for, because both come from the same object — and the corpus
baseline goes red if any stage loses a field, since a state machine missing a
stage still renders as a complete-looking board.
