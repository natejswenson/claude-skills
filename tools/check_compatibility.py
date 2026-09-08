#!/usr/bin/env python3
"""Check both plugin catalogs and every shared release version without writing."""
import argparse
from pathlib import Path

from lint_marketplace import lint_marketplace
from lint_plugin import lint_plugin
from sync_codex import check


def check_compatibility(repo):
    errors = lint_marketplace(str(repo))['errors']
    for path in sorted((repo / 'skills').glob('*/.claude-plugin/plugin.json')):
        errors.extend(lint_plugin(str(path.parent.parent))['errors'])
    try:
        errors.extend(check(repo))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        errors.append(f'Codex compatibility: {exc}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    errors = check_compatibility(args.repo_root)
    if errors:
        print('\n'.join(errors))
        return 1
    print('Claude and Codex compatibility passed: catalogs, shared entrypoints, and release versions.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
