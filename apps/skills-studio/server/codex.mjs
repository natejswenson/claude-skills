import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

// Keep credentials inside Codex. The browser never receives auth files or tokens.
export class CodexClient extends EventEmitter {
  constructor({ command = process.env.STUDIO_CODEX_BIN || 'codex', args = ['app-server', '--stdio', '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"'], cwd, env = process.env, timeout = 30000 } = {}) {
    super();
    this.sequence = 0;
    this.pending = new Map();
    this.timeout = timeout;
    const childEnv = { ...env };
    delete childEnv.OPENAI_API_KEY;
    delete childEnv.CODEX_API_KEY;
    this.child = spawn(command, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderr = '';
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) this.emit('event', message);
      else if (this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });
    const fail = error => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
      this.emit('disconnect', error.message);
    };
    this.child.on('error', fail);
    this.child.on('exit', code => fail(new Error(`Codex disconnected (${code ?? 'signal'}).`)));
    this.child.stdin.on('error', () => {});
  }
  send(message) {
    if (this.child.killed || this.child.exitCode !== null || this.child.stdin.destroyed) throw new Error('Codex is disconnected.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // An accepted turn can outlive a timed-out RPC. Stop the owned process
        // before allowing recovery so a retry cannot create duplicate live work.
        this.child.kill('SIGTERM');
        reject(new Error(`Codex request timed out: ${method}. Reconnect before continuing.`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async initialize() {
    const result = await this.request('initialize', { clientInfo: { name: 'skills_studio', title: 'Skills Studio', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
    return result;
  }
  reply(id, result) { this.send({ id, result }); }
  reject(id, message = 'Unsupported request in Skills Studio.') { this.send({ id, error: { code: -32601, message } }); }
  close() { this.child.kill('SIGTERM'); }
}

export function requireSubscription(account) {
  if (account?.type !== 'chatgpt') throw new Error('Sign in to Codex with ChatGPT first (codex login). Skills Studio requires subscription authentication and will not use API billing.');
}
