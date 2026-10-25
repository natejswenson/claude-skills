import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const groups = {
  ghostwriter: ['Create', 'Draft a LinkedIn post about my recent engineering work.'],
  'ghostwriter-x': ['Create', 'Help me turn an idea into a short X thread.'],
  devlog: ['Create', 'Write a devlog about my recent changes.'],
  resume: ['Create', 'Tailor my résumé to this job: '],
  'city-report': ['Research', 'Create a city report for Austin, Texas.'],
  brandreport: ['Research', 'Research my online presence and prepare a brand report.'],
  'bible-study': ['Research', 'Create a Bible study on John 15.'],
  'github-stats': ['Research', 'Show my GitHub profile statistics.'],
  shipreport: ['Research', 'Summarize what I shipped this week.'],
  gmailtriage: ['Organize', 'Help me review and organize my inbox.'],
  appletv: ['Organize', 'Find my Apple TVs and show what is playing.'],
  netwatch: ['Organize', 'Inspect my Mac’s current network connections.'],
  press: ['Create', 'Help me apply my brand to a new artifact.'],
};

export async function readCatalog(repoRoot) {
  const manifest = JSON.parse(await readFile(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  return Promise.all(manifest.plugins.map(async plugin => {
    const path = resolve(repoRoot, plugin.source, 'skills', plugin.name, 'SKILL.md');
    let source;
    try { await access(path); source = await readFile(path, 'utf8'); } catch { return null; }
    let description = source.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g, '') || 'Open this skill to get started.';
    // Trigger phrases belong to the agent instructions, not the library card.
    description = description.split(/(?<=\.)\s+(?=Use |Triggers |Also )/)[0].replaceAll('\\"', '"');
    const [category, example] = groups[plugin.name] || ['Build', `Help me use ${plugin.name} in my project.`];
    return { id: plugin.name, name: plugin.name, description, path, category, example, available: true, readiness: 'Skill instructions available; external tools depend on your Codex setup.' };
  })).then(items => items.filter(Boolean));
}
