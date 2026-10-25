import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const groups = {
  ghostwriter: ['Create', 'Draft a LinkedIn post about what I learned from a recent engineering project.'],
  'ghostwriter-x': ['Create', 'Draft a short X thread about lessons from shipping a side project.'],
  devlog: ['Create', 'Draft a concept guide for adding search to a personal website.'],
  resume: ['Create', 'Tailor my stored résumé to this job: [job posting URL]'],
  'city-report': ['Research', 'Create a city report for Austin, Texas.'],
  brandreport: ['Research', 'Research the online presence of [full name] and prepare a brand report.'],
  'bible-study': ['Research', 'Create a Bible study on John 15.'],
  'github-stats': ['Research', 'Show GitHub profile statistics for [GitHub username].'],
  shipreport: ['Research', 'Summarize what I shipped this week.'],
  gmailtriage: ['Organize', 'Help me review and organize my inbox.'],
  appletv: ['Organize', 'Find my Apple TVs and show what is playing.'],
  netwatch: ['Organize', 'Inspect my Mac’s current network connections.'],
  press: ['Create', 'Apply PRESS styling to a one-page project report.'],
  shipflow: ['Build', 'Plan branch protection and a release workflow for [repository path].'],
  ghfactory: ['Build', 'Create a GitHub Actions workflow to test and build a Node.js project.'],
  skillfactory: ['Build', 'Create a skill that turns meeting notes into an action-item checklist.'],
  eval: ['Research', 'Evaluate this skill run against its contract: [run transcript path]'],
  release: ['Build', 'Review unreleased changes for [component] and propose a version and changelog.'],
  pluginsync: ['Organize', 'Refresh my installed plugin marketplaces and report whether a restart is needed.'],
  issueflow: ['Build', 'Work on [issue URL] through implementation and a draft pull request.'],
  skillhelp: ['Research', 'Explain how to configure and use [skill name].'],
  issuecreator: ['Build', 'Draft a GitHub issue for adding keyboard shortcuts to [repository path].'],
  traefik: ['Organize', 'Check my local Traefik stack health and explain any failing services.'],
  'local-dev': ['Build', 'Implement a feature that adds keyboard shortcuts in [repository path].'],
  dotfiles: ['Organize', 'Check my dotfile links and report missing or conflicting targets.'],
  'brand-images': ['Create', 'Generate a mountain illustration in my brand style.'],
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
    const [category, example] = groups[plugin.name] || ['Other'];
    return { id: plugin.name, name: plugin.name, description, path, category, example, available: true, readiness: 'Skill instructions available; external tools depend on your Codex setup.' };
  })).then(items => items.filter(Boolean));
}
