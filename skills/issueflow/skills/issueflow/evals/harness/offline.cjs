// Inherited by Node subprocesses. This is a test guard, not an OS security sandbox.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const moduleApi = require('node:module');
function deny(operation) {
  if (process.env.ISSUEFLOW_EVAL_NETWORK_LOG) fs.appendFileSync(process.env.ISSUEFLOW_EVAL_NETWORK_LOG, `${operation}\n`);
  throw new Error(`offline evaluation forbids ${operation}`);
}
for (const name of ['node:http', 'node:https']) {
  const mod = require(name);
  for (const method of ['request', 'get']) mod[method] = () => deny(`${name}.${method}`);
}
for (const method of ['connect', 'createConnection']) require('node:net')[method] = () => deny(`net.${method}`);
require('node:net').Socket.prototype.connect = () => deny('socket.connect');
require('node:tls').connect = () => deny('tls.connect');
globalThis.fetch = () => deny('fetch');
for (const method of ['exec', 'execSync']) cp[method] = () => deny(`shell ${method}`);
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[method];
  cp[method] = function (command, args, ...rest) {
    const executable = path.basename(String(command));
    if (!['git', path.basename(process.execPath)].includes(executable)) deny(`process ${executable}`);
    if (executable === 'git' && (args ?? []).some((arg) => /^(fetch|push|pull|clone|ls-remote|submodule)$/.test(arg))) deny('git network operation');
    return original.call(this, command, args, ...rest);
  };
}
moduleApi.syncBuiltinESMExports();
