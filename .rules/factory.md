# Software Factory

Initial checks cover host compatibility and the gmailtriage redesign. Add the relevant component checks before enrolling another component. Shared repository instructions remain in AGENTS.md and CLAUDE.md.

```factory-config
{
  "version": 1,
  "endpoint": "draft-pr",
  "checks": [
    {
      "name": "compatibility",
      "argv": [
        "python3",
        "tools/check_compatibility.py"
      ],
      "timeoutMs": 120000
    },
    {
      "name": "codex-drift",
      "argv": [
        "python3",
        "tools/sync_codex.py",
        "--check"
      ],
      "timeoutMs": 120000
    },
    {
      "name": "gmailtriage-tests",
      "argv": [
        "node",
        "--test",
        "skills/gmailtriage/skills/gmailtriage/scripts/**/*.test.mjs"
      ],
      "timeoutMs": 120000
    },
    {
      "name": "gmailtriage-skill",
      "argv": [
        "python3",
        "tools/score_skill.py",
        "skills/gmailtriage/skills/gmailtriage",
        "--min",
        "100"
      ],
      "timeoutMs": 120000
    },
    {
      "name": "gmailtriage-plugin",
      "argv": [
        "python3",
        "tools/lint_plugin.py",
        "skills/gmailtriage"
      ],
      "timeoutMs": 120000
    },
    {
      "name": "gmailtriage-brand",
      "argv": [
        "node",
        "skills/press/skills/press/bin/press.js",
        "check",
        "--repo",
        ".",
        "--target",
        "gmailtriage-readme"
      ],
      "timeoutMs": 120000
    }
  ]
}
```
