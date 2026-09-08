import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_codex import render, check
from check_compatibility import check_compatibility


class CodexMetadataTests(unittest.TestCase):
    def make_repo(self, root):
        (root / '.claude-plugin').mkdir()
        (root / '.claude-plugin/marketplace.json').write_text(json.dumps({
            'name': 'both', 'plugins': [{'name': 'sample', 'source': './skills/sample'}],
        }))
        plugin = root / 'skills/sample'
        (plugin / '.claude-plugin').mkdir(parents=True)
        (plugin / '.claude-plugin/plugin.json').write_text(json.dumps({
            'name': 'sample', 'version': '1.0.0', 'description': 'A sample shared skill',
            'author': {'name': 'Example'},
        }))
        skill = plugin / 'skills/sample'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: sample\ndescription: A sample shared skill\nversion: 1.0.0\n---\n\n## Usage\nDo the task.\n')
        return plugin

    def write_codex(self, root):
        for path, data in render(root).items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    def test_generation_and_checks_leave_claude_sources_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_repo(root)
            before = {p: p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.write_codex(root)
            self.assertEqual(check_compatibility(root), [])
            for path, content in before.items():
                self.assertEqual(path.read_bytes(), content)

    def test_release_bump_requires_codex_regeneration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = self.make_repo(root)
            self.write_codex(root)
            for path in [plugin / '.claude-plugin/plugin.json', plugin / 'skills/sample/SKILL.md']:
                path.write_text(path.read_text().replace('1.0.0', '1.1.0'))
            self.assertTrue(check_compatibility(root))
            self.write_codex(root)
            self.assertEqual(check_compatibility(root), [])

    def test_source_version_conflict_fails_even_with_current_codex_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = self.make_repo(root)
            path = plugin / '.claude-plugin/plugin.json'
            path.write_text(path.read_text().replace('1.0.0', '1.1.0'))
            self.write_codex(root)
            self.assertEqual(check(root), [])
            self.assertTrue(any('version mismatch' in e for e in check_compatibility(root)))

    def test_missing_and_orphaned_codex_plugins_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = self.make_repo(root)
            self.write_codex(root)
            manifest = plugin / '.codex-plugin/plugin.json'
            content = manifest.read_text()
            manifest.unlink()
            self.assertTrue(check(root))
            orphan = root / 'skills/orphan/.codex-plugin/plugin.json'
            orphan.parent.mkdir(parents=True)
            orphan.write_text(content)
            self.assertTrue(any('Orphan' in e for e in check(root)))

    def test_claude_components_require_explicit_codex_adapter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = self.make_repo(root)
            path = plugin / '.claude-plugin/plugin.json'
            data = json.loads(path.read_text())
            data['hooks'] = './hooks.json'
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'explicit Codex adapter'):
                render(root)
            self.assertEqual(json.loads(path.read_text())['hooks'], './hooks.json')

    def test_duplicate_catalog_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_repo(root)
            path = root / '.claude-plugin/marketplace.json'
            data = json.loads(path.read_text())
            data['plugins'].append(data['plugins'][0])
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                render(root)

    def test_catalog_resolves_every_plugin_and_matches_release_versions(self):
        root = Path(__file__).resolve().parents[2]
        outputs = render(root)
        catalog = outputs[root / '.agents/plugins/marketplace.json']
        self.assertGreaterEqual(len(catalog['plugins']), 20)
        for entry in catalog['plugins']:
            plugin = root / entry['source']['path']
            manifest = outputs[plugin / '.codex-plugin/plugin.json']
            self.assertEqual(entry['name'], manifest['name'])
            self.assertTrue((plugin / manifest['skills'] / entry['name'] / 'SKILL.md').is_file())
            original = json.loads((plugin / '.claude-plugin/plugin.json').read_text())
            self.assertEqual(manifest['version'], original['version'])

    def test_crosswired_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.claude-plugin').mkdir()
            (root / '.claude-plugin/marketplace.json').write_text(json.dumps({
                'name': 'test', 'plugins': [{'name': 'foo', 'source': './skills/bar'}],
            }))
            with self.assertRaises(ValueError):
                render(root)


if __name__ == '__main__':
    unittest.main()
