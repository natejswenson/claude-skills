#!/usr/bin/env python3
"""Read-only GitHub-flow audit and separately invoked, resumable cutover steps.

This repository's fixed main/dev migration only. No merge, push, release dispatch,
or tag deletion is implemented. Evidence files belong outside the checkout.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

OLD_WORKFLOW = '.github/workflows/dev-to-main-automerge.yml'
NEW_WORKFLOW = '.github/workflows/main-automerge.yml'
REPO_KEYS = ('default_branch', 'allow_auto_merge', 'allow_squash_merge',
             'allow_merge_commit', 'allow_rebase_merge', 'delete_branch_on_merge')


def run(argv, **kwargs):
    result = subprocess.run(argv, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} failed: {result.stderr.strip()}')
    return result.stdout


def api(repo, path='', method='GET', body=None, optional=False, pages=False):
    argv = ['gh', 'api', f'repos/{repo}/{path}'.rstrip('/'), '-X', method]
    if pages:
        argv += ['--paginate', '--slurp']
    if body is not None:
        argv += ['--input', '-']
    result = subprocess.run(argv, input=json.dumps(body) if body is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        if optional and 'HTTP 404' in result.stderr:
            return None
        raise RuntimeError(f'GitHub {method} {path}: {result.stderr.strip()}')
    return json.loads(result.stdout) if result.stdout.strip() else None


def listing(repo, path, key=None):
    pages = api(repo, path, pages=True)
    rows = []
    for page in pages:
        data = page[key] if key else page
        if not isinstance(data, list):
            raise RuntimeError(f'incomplete list: {path}')
        rows.extend(data)
    return rows


def sha(repo, branch):
    value = api(repo, f'git/ref/heads/{branch}', optional=branch == 'dev')
    return value['object']['sha'] if value else None


def tree(repo, ref):
    value = api(repo, f'git/trees/{ref}?recursive=1')
    if value.get('truncated'):
        raise RuntimeError('truncated Git tree; audit incomplete')
    return {x['path']: x for x in value['tree']}


def content(repo, entries, path):
    if path not in entries:
        return None
    value = api(repo, f'git/blobs/{entries[path]["sha"]}')
    if value.get('encoding') != 'base64':
        raise RuntimeError(f'unsupported blob encoding: {path}')
    return base64.b64decode(value['content']).decode()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def save(path, value, exclusive=False):
    path = Path(path)
    if exclusive:
        with path.open('x') as out:
            json.dump(value, out, indent=2)
            out.write('\n')
    else:
        temp = path.with_suffix(path.suffix + '.tmp')
        temp.write_text(json.dumps(value, indent=2) + '\n')
        temp.replace(path)


def pending_components(repo, main, entries, config, tags):
    result = []
    for name in config['release']['components']:
        raw = content(repo, entries, f'skills/{name}/skills/{name}/package.json')
        if raw is not None:
            version = json.loads(raw)['version']
        else:
            raw = content(repo, entries, f'skills/{name}/skills/{name}/SKILL.md')
            match = re.search(r'^version:\s*[\'"]?([^\s\'"]+)', raw or '', re.M)
            if not match:
                raise RuntimeError(f'unreadable main version: {name}')
            version = match[1]
        tag = f'{name}-v{version}'
        tagged = tag in tags
        changed = None
        if tagged:
            # Compare complete trees: the compare endpoint silently caps its
            # changed-file list at 300 across this independently released repo.
            tagged_entries = tree(repo, tags[tag])
            prefix = f'skills/{name}/'
            component_tree = lambda values: {p: x['sha'] for p, x in values.items()
                                             if p.startswith(prefix)}
            changed = component_tree(entries) != component_tree(tagged_entries)
        result.append({'name': name, 'versionOnMain': version, 'tag': tag,
                       'tagExists': tagged, 'changedSinceTag': changed,
                       'pending': not tagged or changed})
    return result


def audit(repo):
    main, dev = sha(repo, 'main'), sha(repo, 'dev')
    settings = api(repo)
    entries = tree(repo, main)
    config = json.loads(content(repo, entries, '.github/shipflow.json'))
    comparisons = api(repo, f'compare/{main}...{dev}') if dev else None
    prs = listing(repo, 'pulls?state=open&per_page=100')
    reminders = []
    for item in listing(repo, 'issues?state=all&labels=release-pending&per_page=100'):
        if 'pull_request' not in item:
            continue
        pr = api(repo, f'pulls/{item["number"]}')
        files = listing(repo, f'pulls/{item["number"]}/files?per_page=100')
        if len(files) >= 3000:
            raise RuntimeError('PR file inventory reached GitHub limit')
        reminders.append({'number': pr['number'], 'head': pr['head']['ref'],
                          'base': pr['base']['ref'], 'merged': pr['merged'],
                          'components': sorted({f['filename'].split('/')[1] for f in files
                                                if f['filename'].startswith('skills/')})})
    tags = {x['name']: x['commit']['sha'] for x in listing(repo, 'tags?per_page=100')}
    rulesets = [api(repo, f'rulesets/{r["id"]}') for r in listing(repo, 'rulesets?per_page=100')]
    workflows = listing(repo, 'actions/workflows?per_page=100', 'workflows')
    active_runs = []
    for status in ('queued', 'in_progress', 'waiting', 'pending', 'requested'):
        active_runs.extend(listing(repo, f'actions/runs?status={status}&per_page=100', 'workflow_runs'))
    components = pending_components(repo, main, entries, config, tags)
    by_name = {c['name']: c for c in components}
    for reminder in reminders:
        reminder['componentStatus'] = []
        for name in reminder['components']:
            if name in by_name:
                reminder['componentStatus'].append(by_name[name])
            elif any(p.startswith(f'skills/{name}/') for p in entries):
                raise RuntimeError(f'changed component is not declared: {name}')
            else:
                reminder['componentStatus'].append({'name': name, 'status': 'removed-from-main'})
    observed = {
        'schema': 1, 'repository': repo, 'capturedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'branches': {'main': main, 'dev': dev},
        'uniqueDevCommits': comparisons['ahead_by'] if comparisons else 0,
        'comparison': comparisons,
        'settings': {key: settings.get(key) for key in REPO_KEYS},
        'protection': {b: api(repo, f'branches/{b}/protection', optional=True)
                       if ref else None for b, ref in [('main', main), ('dev', dev)]},
        'rulesets': rulesets, 'openPRs': prs, 'pendingReminders': reminders,
        'components': components,
        'tags': tags, 'workflows': workflows, 'activeRuns': active_runs,
        'configOnMain': config,
        'settingsScriptOnMain': content(repo, entries, '.github/repo-settings.sh'),
        'promotionWorkflowOnMain': content(repo, entries, OLD_WORKFLOW),
        'mainWorkflowOnMain': content(repo, entries, NEW_WORKFLOW),
    }
    # A long inventory is not proof of the SHAs at its completion.
    if observed['branches'] != {'main': sha(repo, 'main'), 'dev': sha(repo, 'dev')}:
        raise RuntimeError('branches changed during audit; retry into a new evidence file')
    observed['evidenceHash'] = digest(observed)
    return observed


def verify_settings(repo, config):
    current = api(repo)
    for key, expected in {'default_branch': 'main', 'allow_auto_merge': True,
                          'allow_squash_merge': True, 'allow_merge_commit': False,
                          'allow_rebase_merge': False, 'delete_branch_on_merge': True}.items():
        if current.get(key) != expected:
            raise RuntimeError(f'live settings mismatch: {key}')
    protection = api(repo, 'branches/main/protection')
    checks = protection.get('required_status_checks') or {}
    if sorted(checks.get('contexts', [])) != sorted(config['requiredChecks']) or checks.get('strict') is not False:
        raise RuntimeError('live required checks differ from policy')
    reviews = protection.get('required_pull_request_reviews')
    if not isinstance(reviews, dict) or reviews.get('required_approving_review_count') != 0:
        raise RuntimeError('main must require a PR with the existing solo-maintainer policy')
    for key, expected in {'enforce_admins': False, 'allow_deletions': False,
                          'allow_force_pushes': False, 'required_linear_history': True}.items():
        if protection.get(key, {}).get('enabled') != expected:
            raise RuntimeError(f'live protection mismatch: {key}')


def execute(args):
    observed = json.loads(Path(args.audit).read_text())
    fingerprint = observed.pop('evidenceHash')
    if digest(observed) != fingerprint or observed['repository'] != args.repository:
        raise RuntimeError('audit hash/repository mismatch')
    observed['evidenceHash'] = fingerprint
    age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(observed['capturedAt'])
    if age.total_seconds() < 0 or age.total_seconds() > 86400:
        raise RuntimeError('audit older than 24 hours; capture fresh evidence')
    state_path = Path(args.state)
    if state_path.resolve() == Path(args.audit).resolve():
        raise RuntimeError('journal must not overwrite original audit')
    journal = json.loads(state_path.read_text()) if state_path.exists() else {
        'auditHash': fingerprint, 'recovery': observed, 'operations': []}
    if journal['auditHash'] != fingerprint:
        raise RuntimeError('journal belongs to a different audit')
    repo = args.repository

    def guard():
        current = {'main': sha(repo, 'main'), 'dev': sha(repo, 'dev')}
        expected = observed['branches']
        deletion_started = any(x['action'] == 'delete-dev' for x in journal['operations'])
        if current['main'] != expected['main'] or (current['dev'] != expected['dev'] and
                not (deletion_started and current['dev'] is None)):
            raise RuntimeError('captured branch SHAs changed; no mutation attempted')
        if current['dev']:
            comparison = api(repo, f'compare/{current["main"]}...{current["dev"]}')
            if comparison['ahead_by']:
                raise RuntimeError('unique dev work remains; preserve it through a reviewed main PR')

    def mutate(action, callback):
        guard()
        record = {'action': action, 'status': 'attempted'}
        journal['operations'].append(record)
        save(state_path, journal)  # Preserve intent even if the response is lost.
        callback()
        record['status'] = 'verified'
        save(state_path, journal)

    guard()
    checkout = Path(args.checkout).resolve()
    config = json.loads((checkout / '.github/shipflow.json').read_text())
    if config.get('workflowPattern') != 'github-flow' or config.get('branches') != {'main': 'main'}:
        raise RuntimeError('checkout must declare main-only GitHub flow')
    if run(['git', '-C', str(checkout), 'rev-parse', 'HEAD']).strip() != observed['branches']['main']:
        raise RuntimeError('cutover code is not the audited main commit; merge and check out main first')
    if run(['git', '-C', str(checkout), 'status', '--porcelain', '--untracked-files=no']).strip():
        raise RuntimeError('tracked checkout changes must be committed before cutover')
    if config != observed['configOnMain'] or (checkout / '.github/repo-settings.sh').read_text() != observed['settingsScriptOnMain']:
        raise RuntimeError('local policy differs from audited main')
    if observed['promotionWorkflowOnMain'] is not None or observed['mainWorkflowOnMain'] is None:
        raise RuntimeError('workflow cutover must be merged into main first')
    save(state_path, journal)

    if args.step == 'settings':
        def settings():
            run(['bash', '.github/repo-settings.sh'], cwd=checkout,
                env={**os.environ, 'REPO': repo})
            verify_settings(repo, config)
        mutate('settings', settings)
    else:
        verify_settings(repo, config)

    if args.step == 'retarget':
        captured = {p['number']: p for p in observed['openPRs']}
        for pr in listing(repo, 'pulls?state=open&per_page=100'):
            if pr['base']['ref'] != 'dev':
                continue  # Preserve valid upper stack relationships.
            old = captured.get(pr['number'])
            if not old or old['head']['sha'] != pr['head']['sha'] or old['base']['ref'] != 'dev':
                raise RuntimeError('new or changed dev-based PR; capture fresh audit')
            if pr['head']['ref'] == 'main':
                raise RuntimeError('reverse promotion needs a manual reviewed disposition')
            def retarget(pr=pr):
                fresh = api(repo, f'pulls/{pr["number"]}')
                if fresh['head']['sha'] != pr['head']['sha'] or fresh['base']['ref'] != 'dev':
                    raise RuntimeError('PR changed before retarget')
                api(repo, f'pulls/{pr["number"]}', 'PATCH', {'base': 'main'})
                changed = api(repo, f'pulls/{pr["number"]}')
                if changed['base']['ref'] != 'main':
                    raise RuntimeError('PR retarget read-back mismatch')
            mutate(f'retarget-{pr["number"]}', retarget)

    if args.step == 'reminders':
        # This command resolves obsolete promotion reminders, never release work.
        # The immutable recovery inventory retains each PR -> component mapping.
        for reminder in observed['pendingReminders']:
            if reminder['head'] != 'dev' or not reminder['merged']:
                continue
            def clear(reminder=reminder):
                path = f'issues/{reminder["number"]}/labels'
                if any(x['name'] == 'release-pending' for x in listing(repo, path + '?per_page=100')):
                    api(repo, path + '/release-pending', 'DELETE')
                if any(x['name'] == 'release-pending' for x in listing(repo, path + '?per_page=100')):
                    raise RuntimeError('label removal read-back mismatch')
            mutate(f'reminder-{reminder["number"]}', clear)

    if args.step == 'retire':
        live = audit(repo)
        if live['uniqueDevCommits'] or any(p['base']['ref'] == 'dev' for p in live['openPRs']):
            raise RuntimeError('unique work or open dev PR bases remain')
        if any(p['head'] == 'dev' for p in live['pendingReminders']):
            raise RuntimeError('unresolved old promotion reminders remain')
        if live['activeRuns']:
            raise RuntimeError('active workflow runs remain; wait and re-audit')
        for workflow in live['workflows']:
            if workflow['path'] == OLD_WORKFLOW and workflow['state'] != 'disabled_manually':
                def disable(workflow=workflow):
                    api(repo, f'actions/workflows/{workflow["id"]}/disable', 'PUT')
                    if api(repo, f'actions/workflows/{workflow["id"]}')['state'] != 'disabled_manually':
                        raise RuntimeError('workflow disable read-back mismatch')
                mutate('disable-promotion', disable)
        if sha(repo, 'dev'):
            def unlock():
                if api(repo, 'branches/dev/protection', optional=True) is not None:
                    api(repo, 'branches/dev/protection', 'DELETE')
                if api(repo, 'branches/dev/protection', optional=True) is not None:
                    raise RuntimeError('dev protection removal read-back mismatch')
            mutate('unlock-dev', unlock)
            def delete():
                # A last inventory closes the long-audit window before deletion.
                if any(p['base']['ref'] == 'dev' for p in listing(repo, 'pulls?state=open&per_page=100')):
                    raise RuntimeError('new dev PR appeared before deletion')
                api(repo, 'git/refs/heads/dev', 'DELETE')
                if sha(repo, 'dev') is not None:
                    raise RuntimeError('dev deletion read-back mismatch')
            mutate('delete-dev', delete)
        journal['finalAudit'] = audit(repo)
        save(state_path, journal)
    return {'ok': True, 'step': args.step, 'journal': str(state_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', default='natejswenson/claude-skills')
    sub = parser.add_subparsers(dest='command', required=True)
    inspect = sub.add_parser('audit', help='read-only; write a new evidence file')
    inspect.add_argument('--output', required=True)
    apply = sub.add_parser('execute', help='post-merge authorized operations only')
    apply.add_argument('--audit', required=True)
    apply.add_argument('--state', required=True)
    apply.add_argument('--checkout', default='.')
    apply.add_argument('--step', choices=['settings', 'retarget', 'reminders', 'retire'], required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', args.repository):
        parser.error('repository must be owner/name')
    try:
        if args.command == 'audit':
            result = audit(args.repository)
            save(args.output, result, exclusive=True)
            print(json.dumps({'ok': True, 'audit': args.output, 'uniqueDevCommits': result['uniqueDevCommits']}))
        else:
            print(json.dumps(execute(args)))
    except (RuntimeError, KeyError, ValueError, OSError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
