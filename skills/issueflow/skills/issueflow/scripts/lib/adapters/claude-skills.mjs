/** Repository-specific generated-file relationships, never global issueflow policy. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
export function claudeSkillsOutputs(repo, paths) {
  if (!existsSync(join(repo,'tools/sync_codex.py')) || !existsSync(join(repo,'skills/skillhelp/skills/skillhelp/scripts/skillhelp.js'))) return [];
  const results=[];
  for (const input of paths) {
    const match=/^skills\/([^/]+)\//.exec(input);
    if (!match || input.startsWith('skills/skillhelp/skills/skillhelp/index/')) continue;
    const name=match[1];
    if (/(?:SKILL\.md|README\.md|package\.json|scripts\/.*\.(?:mjs|js|py))$/.test(input)) {
      for (const output of [`skills/skillhelp/skills/skillhelp/index/${name}.md`,'skills/skillhelp/skills/skillhelp/index/_manifest.json']) results.push({input,output,generator:'skillhelp build'});
    }
    if (/(?:package\.json|\.claude-plugin\/plugin\.json)$/.test(input)) {
      for (const output of [`skills/${name}/.codex-plugin/plugin.json`,'.agents/plugins/marketplace.json']) results.push({input,output,generator:'python3 tools/sync_codex.py'});
    }
  }
  return results;
}
