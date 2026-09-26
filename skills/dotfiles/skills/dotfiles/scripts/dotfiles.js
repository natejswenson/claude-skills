#!/usr/bin/env node
import { inspect, readSnapshot, verify, render } from './lib/inspect.mjs';

const HELP = `dotfiles — inspect package-based dotfiles without changing files

  inspect --repo PATH --target PATH [--package NAME ...] [--json]
  verify  --repo PATH --target PATH [--package NAME ...] [--json]
  report  --input FILE

inspect exits 0 for a valid inspection, including missing/conflicting links.
verify exits 1 unless all selected files have correct links. Invalid input exits 1.
Every snapshot requires a separate installer-policy review before mutation.
No command runs repository scripts, reads config bodies or changes dotfiles.`;
function main(argv) {
  if (!argv.length || argv.includes('--help')) { console.log(HELP); return; }
  const [command, ...args] = argv;
  if (!['inspect', 'verify', 'report'].includes(command)) throw new Error('Unknown command; use --help');
  const opts = { packages: [] };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--json' && command !== 'report') { opts.json = true; continue; }
    const allowed = command === 'report' ? ['--input'] : ['--repo', '--target', '--package'];
    if (!allowed.includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--package') opts.packages.push(value);
    else {
      const key = flag.slice(2);
      if (opts[key] !== undefined) throw new Error(`Duplicate option: ${flag}`);
      opts[key] = value;
    }
  }
  if (command === 'report' && !opts.input) throw new Error('--input is required');
  const snapshot = command === 'report' ? readSnapshot(opts.input) : inspect(opts);
  process.stdout.write(opts.json ? JSON.stringify(snapshot, null, 2) + '\n' : render(snapshot));
  if (command === 'verify' && !verify(snapshot)) process.exitCode = 1;
}
try { main(process.argv.slice(2)); }
catch (e) { console.error(`dotfiles: ${e.message}`); process.exitCode = 1; }
