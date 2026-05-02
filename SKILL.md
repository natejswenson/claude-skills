---
name: devlog
description: Generate a daily dev log entry from today's git commits and publish to GitHub
user_invocable: true
---

# /devlog — Daily Dev Log Generator

You are generating a daily dev log entry from the user's git commits and publishing it to a GitHub repo configured in `~/.claude/skills/devlog/config.json`.

Usage: `/devlog` (all configured projects) or `/devlog <project-key>` (single project)

## Configuration

This skill is configuration-driven. All user-specific values (target repo, git author, project list) live in `~/.claude/skills/devlog/config.json`.

Schema:

```json
{
  "targetRepo": "<owner>/<repo>",
  "gitAuthor": "Your Name",
  "githubUser": "<your-github-username>",
  "projects": [
    {
      "key": "project-key",
      "path": "/absolute/path/to/project",
      "remote": "<owner>/<repo>"
    }
  ]
}
```

## Step 0: Load and validate config

```bash
cat ~/.claude/skills/devlog/config.json
```

If the file does not exist or cannot be parsed, stop and tell the user:

> No devlog config found at `~/.claude/skills/devlog/config.json`. Run `npx @natejswenson/devlog init` to set up, or copy `config.example.json` from the devlog repo and fill it in manually.

Validate that `targetRepo`, `gitAuthor`, `githubUser`, and `projects` (non-empty array) are all present. Each project must have `key`, `path`, and `remote`.

## Step 1: Determine scope

- If the user passed a project argument (e.g. `/devlog myproject`), filter `projects` to that one. If the key is not in the registry, list available keys and stop.
- If no argument, run for **all projects** in `config.projects`. Generate a separate entry per project (only for projects that have commits today). Use a single clone of the target repo and a single commit/push for all entries.

## Step 2: Gather today's commits

For each project in scope, run:

```bash
cd <project.path> && git log --author="<config.gitAuthor>" --since="midnight" --format="%H|%s|%D" --all
```

If no commits are found for a project, skip it. If no commits are found across all projects, inform the user and stop.

## Step 3: Check for public commits

For each commit, check if it's on the `main` branch and if the remote is public:

```bash
cd <project.path> && git remote get-url origin
git branch --contains <hash> -r 2>/dev/null | grep -q 'origin/main'
```

- If the remote URL matches `<project.remote>` (i.e. `github.com/<project.remote>` or the SSH equivalent) and the commit is on `origin/main`, it's a public commit — include a link using `https://github.com/<project.remote>/commit/<hash>`.
- Otherwise, describe the feature without linking.

## Step 4: Generate the entry

Based on the commit messages, generate a markdown entry with this structure:

```markdown
---
title: "<concise title summarizing the day's work>"
date: YYYY-MM-DD
project: <project.key>
summary: "<1-2 sentence summary>"
---

## What I Built

<Narrative paragraphs about features implemented. Focus on WHAT was built and WHY, not raw commit messages. Group related commits into coherent feature descriptions. Write in first person, casual but professional tone.>

## What's Next

<Brief 1-2 sentence forward-looking note based on the trajectory of current work.>

## Public Commits

- [<project.key>] commit message ([short-hash](https://github.com/<project.remote>/commit/full-hash))
```

**Important rules for content generation:**
- The "What I Built" section is a NARRATIVE, not a commit list. Describe features, not individual commits.
- Only include "Public Commits" section if there are commits on `main` of a public repo.
- "What's Next" should be a reasonable inference from the work done today.
- Tone: first person, casual but professional, like a senior engineer's standup notes for a public audience.

## Step 5: Check for existing entry (append mode)

For each project with commits, check if an entry for today already exists:

```bash
gh api repos/<config.targetRepo>/contents/<project.key>/YYYY-MM-DD.md --jq '.content' 2>/dev/null | base64 -d
```

**If the entry exists:**
1. Fetch and read the existing content
2. Keep the original frontmatter (title, date, project, summary) unchanged
3. Append new content under an `## Update — HH:MM AM/PM` heading
4. Merge any new public commits into the existing "Public Commits" section
5. Update "What's Next" with the latest context

**If the entry does NOT exist:**
1. Create a new file with the full structure above

## Step 6: Push to GitHub

Clone the repo once, write all project entries, then push:

```bash
# Clone to temp directory
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
git clone https://github.com/<config.targetRepo>.git
cd $(basename <config.targetRepo>)

# For each project with commits:
# - Create directory if needed: mkdir -p <project.key>/
# - Write the entry file to <project.key>/YYYY-MM-DD.md
# - Update <project.key>/manifest.json
#   - Read manifest, add/update entry in entries array (newest first)
#   - Entry object: { "date": "YYYY-MM-DD", "file": "YYYY-MM-DD.md", "title": "...", "summary": "..." }
#   - If appending to existing entry, update title/summary only if changed
#   - If manifest doesn't exist, create it as { "entries": [...] }

# Stage all changed project directories
git add .

# Single commit covering all projects
git commit -m "devlog: add entries for YYYY-MM-DD"
git push origin main

# Cleanup
rm -rf "$TMPDIR"
```

## Step 7: Confirm

After pushing, output a summary for each project:

```
Dev log entries published for <Month Day, Year>

  Project: <project.key>
  Commits summarized: <count>
  Public commits linked: <count>
  URL: https://github.com/<config.targetRepo>/blob/main/<project.key>/YYYY-MM-DD.md
```

## Edge Cases

- **No commits today:** Stop with a message. Do not create an empty entry.
- **Project path doesn't exist:** Error with "Repository not found at <project.path>" and skip that project.
- **Push fails:** Inform the user of the error. Do not retry automatically.
- **All WIP/fixup commits:** Still generate a narrative about the intent of the work.
- **Manifest doesn't exist:** Create it with the standard structure.
- **Unknown project argument:** List available project keys from `config.projects`.
- **Config missing or invalid:** Stop at Step 0 with the setup instructions above.
