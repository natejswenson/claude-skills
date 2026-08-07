# Where the data comes from

Two sources, one cache. `index` is the only networked command in the skill;
everything after it reads the corpus, which is what lets the baseline eval
re-run `rank` and `render` offline and byte-compare them.

## Claude Code sessions

`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` — an append log, one JSON
object per line. The fields that matter:

| Field | On | Is |
|---|---|---|
| `sessionId` | most records | the session identity, and its receipt |
| `timestamp` | message records | ISO 8601; min and max give the span |
| `cwd` | message records | the project — its basename is what `rank` matches against a repository name |
| `gitBranch` | message records | which branch the work was on |
| `aiTitle` | `type: "ai-title"` | a written session title — the best summary line available |
| `uuid` | `user` / `assistant` | one message; the granular receipt |
| `attributionSkill` | `assistant` | which skill produced the turn |
| `message.content[].type == "tool_use"` | `assistant` | tool name; `Edit`/`Write` counts are the edit signal |

**A digest is kept; the transcript is not.** The digest is what a report can
cite. The transcript is where the secrets are.

## GitHub

Via `gh`, already authenticated.

| Items | Command |
|---|---|
| merged pull requests | `gh search prs --author <login> --merged-at ">=<date>"` |
| commits | `gh search commits --author <login> --author-date ">=<date>"` |
| releases | `gh api repos/<repo>/releases`, only for repos the user touched |

**The two search endpoints disagree on a field name.** `gh search prs` returns
`repository.nameWithOwner`; `gh search commits` returns `repository.fullName`.
Reading only one yields `commit:undefined@a1b2c3d` in the receipt id — which
then makes the squash fold silently match nothing, so every squash-merged pull
request is counted twice. Both names are read. This was found by running the
skill, not by reviewing it.

Releases are fetched only for repositories that already appeared in the pull
request or commit results, so a year-long backfill does not walk every
repository the account can see.

## Redaction

At ingest, never later. A secret written to the cache is a secret that every
subsequent run and every model pass reads.

Classes: assigned secrets (`*_TOKEN=`, `*_SECRET=`, `*API_KEY=`), Anthropic and
OpenAI key shapes, GitHub tokens and PATs, AWS access key ids, Slack tokens,
JWTs, bearer headers, PEM private key blocks, email addresses, and the absolute
home directory.

**Zero redactions on a real scan is not proof the redactor ran.** It usually
means nothing matched, which is the common case. The proof is in the tests,
which feed it a seeded transcript.

## The watermark, and the two passes

`meta.json` holds a watermark per source.

- **First pass** — no watermark: backfills 365 days of GitHub and every session
  transcript on disk. Slow, once.
- **Later passes** — read the watermark and take only what is newer. Sessions
  are filtered by file mtime before a transcript is opened, so a typical second
  run reads one file instead of hundreds.

`--full` forces a backfill. Items merge by id, so re-indexing is idempotent and
a partial failure is safe to retry.

## The limit worth stating out loud

Session history reaches back only as far as the transcripts on this machine —
typically weeks, not a year, and it does not survive a new machine. GitHub
reaches back a year. A report over a long window is therefore GitHub-deep and
session-shallow, and it should say so rather than imply an even record.
