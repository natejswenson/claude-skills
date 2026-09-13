/** One selected repository base, shared by planning, lanes and verification. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from './contracts.mjs';
import { RunError } from './run.mjs';
import { resolvePolicy } from './policy.mjs';
const git = (repo, ...args) => execFileSync('git', args, { cwd:repo, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
export function freezeRepository(run, { policyFromSelectedBase = false } = {}) {
  if (run.repositorySnapshot) return run.repositorySnapshot;
  const repo = run.repo.path, ref = run.policy.base;
  try {
    git(repo, 'check-ref-format', `refs/heads/${ref}`);
    const remote = git(repo, 'remote').split('\n').includes('origin');
    if (!run.offline && remote) git(repo, 'fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`);
    const selected = !run.offline && remote ? `refs/remotes/origin/${ref}` : `refs/heads/${ref}`;
    const sha = git(repo, 'rev-parse', '--verify', `${selected}^{commit}`);
    const paths = ['AGENTS.md', 'CLAUDE.md', '.github/shipflow.json'];
    const committedPaths = policyFromSelectedBase ? git(repo,'ls-tree','--name-only',sha,'--',...paths).split('\n') : [];
    const contents = Object.fromEntries(paths.filter(p=>policyFromSelectedBase?committedPaths.includes(p):existsSync(join(repo,p)))
      .map(p=>[p,policyFromSelectedBase?execFileSync('git',['show',`${sha}:${p}`],{cwd:repo}):readFileSync(join(repo,p))]));
    if(policyFromSelectedBase) {
      const raw=contents['.github/shipflow.json'];
      const config=raw?JSON.parse(raw.toString()):null;
      if(raw&&(!config||typeof config!=='object'||Array.isArray(config)))throw new Error('invalid committed .github/shipflow.json');
      const policy=resolvePolicy(repo,run.repo.defaultBranch??'main',{configOverride:config,...(run.offline?{remoteBranches:[]}: {})});
      if(policy.base!==ref)throw new Error(`selected migration base ${ref} conflicts with committed repository policy ${policy.base}`);
      run.policy=policy;
    }
    for(const file of ['AGENTS.md','CLAUDE.md']) {
      if(!contents[file])continue;
      const text=contents[file].toString();
      const explicit=[...text.matchAll(/feature PRs? (?:must )?target(?:s)? [`]?([A-Za-z0-9_./-]+)/gi),...text.matchAll(/feature\/\*\s*(?:→|->)\s*([A-Za-z0-9_./-]+)/g)].map(m=>m[1]);
      if(explicit.some(base=>base!==ref))throw new Error(`${file} declares a different feature target (${[...new Set(explicit)].join(', ')}); reconcile with ${run.policy.source}`);
    }
    const sources = Object.entries(contents).map(([path,bytes])=>({path,hash:hash(bytes)}));
    const snapshot = { repository:`${run.repo.owner}/${run.repo.name}`, ref, sha, selected,
      policyHash:hash(run.policy), policySources:sources, observedAt:new Date().toISOString(), offline:run.offline };
    run.repositorySnapshot = snapshot;
    if (run.harness) for (const lane of run.lanes) if (lane.base === ref) run.harness.bases[lane.slug] = sha;
    return snapshot;
  } catch (error) {
    throw new RunError(`cannot freeze repository base ${ref}; reconcile its branch policy before planning: ${String(error.stderr ?? error.message).trim()}`);
  }
}
