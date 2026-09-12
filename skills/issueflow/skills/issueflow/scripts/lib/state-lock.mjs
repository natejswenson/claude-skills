/** Short local state transactions. Never hold this lock while awaiting a worker. */
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class StateConflict extends Error {}
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
};

export function withStateLock(dir, fn) {
  const path = join(dir, 'controller.lock');
  let fd;
  const claim = () => openSync(path, 'wx', 0o600);
  try { fd = claim(); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Recovery is serialized separately, so two reclaimers cannot remove a
    // newly acquired lock. A missing/partial owner is ambiguous, not permission.
    let reaper;
    const reapPath = join(dir, 'controller.recovering');
    try {
      reaper = openSync(reapPath, 'wx', 0o600);
      const stat = lstatSync(path);
      const owner = JSON.parse(readFileSync(path, 'utf8'));
      if (stat.isSymbolicLink() || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || alive(owner.pid)) throw new StateConflict('another controller owns this run; retry after it finishes');
      if (lstatSync(path).ino !== stat.ino) throw new StateConflict('controller ownership changed during recovery; retry');
      unlinkSync(path);
      fd = claim();
    } catch (e) {
      if (e instanceof StateConflict) throw e;
      throw new StateConflict('controller lock is busy or incomplete; inspect its owner before recovery');
    } finally {
      if (reaper != null) { closeSync(reaper); unlinkSync(reapPath); }
    }
  }
  const inode = fstatSync(fd).ino;
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), token: randomUUID() }));
    return fn();
  } finally {
    closeSync(fd);
    if (existsSync(path) && lstatSync(path).ino === inode) unlinkSync(path);
  }
}

/** Persist command ownership between short transactions, including remote waits.
 * No filesystem mutex is held while executing the command. A dead local owner
 * can be reclaimed; its unconfirmed remote intents still require reconciliation.
 */
export function claimController(dir, command) {
  const path = join(dir, 'controller-owner.json');
  const token = randomUUID();
  withStateLock(dir, () => {
    if (existsSync(path)) {
      const owner = JSON.parse(readFileSync(path, 'utf8'));
      if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || alive(owner.pid)) throw new StateConflict(`controller ${owner.pid} is still executing ${owner.command}; no concurrent transition permitted`);
    }
    writeFileSync(path, JSON.stringify({ token, pid: process.pid, host: hostname(), command }));
  });
  return () => withStateLock(dir, () => {
    if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path);
  });
}
