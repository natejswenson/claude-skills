# Working in this repository

Claude Code and Codex are both supported targets. Preserve the Claude catalog,
manifests, slash invocations, and existing configuration paths while extending
Codex support. Share implementation files where possible; keep host-specific
tool and session handling explicitly conditional. A change is not compatible
merely because one host can load it.

Read [CLAUDE.md](CLAUDE.md) for the shared branch, release, testing, and branding
conventions. They also apply to Codex. Feature PRs target `dev`; releases are
explicitly dispatched after promotion to `main`.

Each `skills/<name>` is a plugin with a shared `skills/<name>/SKILL.md` entrypoint.
Codex manifests are generated from the existing release metadata. After adding a
plugin or changing its manifest/version, run `python3 tools/sync_codex.py` and
commit the generated files. `python3 tools/sync_codex.py --check` checks drift.
Run `python3 tools/check_compatibility.py` for the combined Claude/Codex check.
New host-specific manifest components require an explicit adapter and tests;
do not remove the Claude component just to make Codex validation pass.

The `~/.claude/<skill>` paths are retained personal-data locations used by the
scripts, including credentials and voice profiles. Do not rename them as part of
an invocation or copy them into a plugin. Resolve bundled files relative to the
loaded SKILL.md; pass the user's repository separately where supported.
