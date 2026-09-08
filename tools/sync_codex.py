#!/usr/bin/env python3
"""Generate Codex metadata from the existing per-plugin release metadata."""
import argparse
import json
import re
from pathlib import Path

# Shared descriptive fields only. Claude component declarations must be adapted
# deliberately, rather than copied into a manifest Codex cannot load.
SHARED_FIELDS = {'name', 'version', 'description', 'author', 'homepage',
                 'repository', 'license', 'keywords'}


def render(repo):
    catalog = json.loads((repo / '.claude-plugin/marketplace.json').read_text())
    outputs = {}
    entries = []
    seen = set()
    for entry in catalog['plugins']:
        name = entry['name']
        if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name):
            raise ValueError(f'Invalid plugin name: {name!r}')
        if name in seen:
            raise ValueError(f'Duplicate plugin: {name}')
        seen.add(name)
        root = repo / entry['source']
        if root.resolve() != (repo / 'skills' / name).resolve():
            raise ValueError(f'Unexpected plugin source: {entry}')
        manifest = json.loads((root / '.claude-plugin/plugin.json').read_text())
        unsupported = set(manifest) - SHARED_FIELDS
        if unsupported:
            raise ValueError(f'{name}: Claude fields {sorted(unsupported)} need an explicit Codex adapter')
        if manifest['name'] != name or not (root / 'skills' / name / 'SKILL.md').is_file():
            raise ValueError(f'Invalid plugin: {name}')
        manifest['skills'] = './skills/'
        manifest['interface'] = {
            'displayName': name,
            'shortDescription': manifest['description'][:120],
            'longDescription': manifest['description'],
            'developerName': manifest['author']['name'],
            'category': 'Productivity',
            'capabilities': [],
            'defaultPrompt': [f'Use ${name} to help me.'],
        }
        outputs[root / '.codex-plugin/plugin.json'] = manifest
        entries.append({
            'name': name,
            'source': {'source': 'local', 'path': entry['source']},
            'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'},
            'category': 'Productivity',
        })
    outputs[repo / '.agents/plugins/marketplace.json'] = {
        'name': catalog['name'],
        'interface': {'displayName': 'Nate Swenson Skills'},
        'plugins': entries,
    }
    return outputs


def check(repo):
    """Read-only drift check, including Codex plugins removed from the catalog."""
    outputs = render(repo)
    errors = []
    for path, data in outputs.items():
        expected = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
        if not path.exists() or path.read_text() != expected:
            errors.append(f'Missing or stale Codex metadata: {path}')
    for path in (repo / 'skills').glob('*/.codex-plugin/plugin.json'):
        if path not in outputs:
            errors.append(f'Orphan Codex manifest: {path}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--check', action='store_true', help='Fail on missing or stale metadata; write nothing')
    parser.add_argument('--marketplace-output', type=Path, help='Stage the catalog at an alternate path for review')
    args = parser.parse_args()
    if args.check and not args.marketplace_output:
        errors = check(args.repo_root)
        if errors:
            print('\n'.join(errors))
            print('Run python3 tools/sync_codex.py; review orphan manifests separately.')
            return 1
        print('Codex metadata checked.')
        return 0
    stale = []
    for path, data in render(args.repo_root).items():
        if args.marketplace_output and path.name == 'marketplace.json':
            path = args.marketplace_output
        expected = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
        if path.exists() and path.read_text() == expected:
            continue
        stale.append(str(path))
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected)
    if args.check and stale:
        print('Codex metadata missing or stale; run python3 tools/sync_codex.py:\n' + '\n'.join(stale))
        return 1
    print(f'Codex metadata {"checked" if args.check else "synchronized"}.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
