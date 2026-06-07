/**
 * BudgetBroker — the single writer to state.json for a multi-worker overnight
 * run. Owns budget, target queue, variant ledger. All mutating ops go through
 * an internal async-mutex so concurrent callers (in-process or over the Unix
 * socket) are serialized. Every mutation is appended to a WAL (NDJSON) before
 * acking, so a crash + `--resume` replays to an identical in-memory state.
 *
 * Invariants:
 *   - reserve() + commit()/release() are atomic from the caller's perspective
 *   - cumulative + in_flight never exceeds cap at any observable moment
 *   - TTL-expired reservations are reaped back to the pool
 *   - Fencing tokens (per-target `gen`) prevent double-commit after reap
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const EPS = 1e-9;

export class BudgetBroker {
  /**
   * @param {{
   *   capUsd: number,
   *   stateFile: string,
   *   walFile: string,
   *   socketPath: string,
   *   nowFn?: () => number,
   *   persistEvery?: number,
   *   maxVariantsPerTarget?: number,  // how many committed variants per target before it retires
   * }} opts
   */
  constructor(opts) {
    this.capUsd = opts.capUsd;
    this.stateFile = opts.stateFile;
    this.walFile = opts.walFile;
    this.socketPath = opts.socketPath;
    this.now = opts.nowFn ?? (() => Date.now());
    this.persistEvery = opts.persistEvery ?? 25;
    this.maxVariantsPerTarget = opts.maxVariantsPerTarget ?? 1;

    this.running = false;
    this.shuttingDown = false;

    // State
    this.reservations = new Map(); // id -> { amountUsd, meta, expiresAt, createdAt }
    this.cumulativeUsd = 0;
    this.targets = new Map(); // id -> { stage, lane, gen, status, variantIds }
    this.targetQueue = []; // FIFO list of target ids with status=pending
    this.variants = new Map(); // id -> { targetId, gen, scores, patchPath, committedAt }
    this.phase = "seed";
    this.startedAt = this.now();

    this._queue = Promise.resolve(); // mutex
    this._opsSincePersist = 0;
    this._server = null;
  }

  /** Acquire the async-mutex around `fn`. Guarantees serial execution. */
  _serialize(fn) {
    const next = this._queue.then(fn);
    // Prevent one rejection from breaking the chain for subsequent callers
    this._queue = next.catch(() => {});
    return next;
  }

  async start() {
    mkdirSync(dirname(this.walFile), { recursive: true });
    this._loadState();
    this._replayWAL();
    await this._startSocket();
    this.running = true;
  }

  async shutdown() {
    if (!this.running) return;
    this.shuttingDown = true;
    // Drain the mutex so any in-flight op persists before we close
    await this._serialize(() => {});
    this._persistStateSync();
    await this._stopSocket();
    this.running = false;
  }

  // ============================================================
  // Budget ops
  // ============================================================

  /**
   * @returns {Promise<{ id: string } | { error: 'exceeded' | 'shutting_down' }>}
   */
  reserve(amountUsd, meta, ttlMs) {
    return this._serialize(() => {
      if (this.shuttingDown) return { error: "shutting_down" };
      this._reapExpiredInner();
      const inFlight = this._inFlightInner();
      if (this.cumulativeUsd + inFlight + amountUsd > this.capUsd + EPS) {
        return { error: "exceeded" };
      }
      const id = randomUUID();
      const entry = {
        amountUsd,
        meta,
        expiresAt: this.now() + ttlMs,
        createdAt: this.now(),
      };
      this._appendWAL({ op: "reserve", id, amt: amountUsd, meta, ttl: ttlMs });
      this.reservations.set(id, entry);
      this._afterMutate();
      return { id };
    });
  }

  commit(id, actualUsd) {
    return this._serialize(() => {
      const r = this.reservations.get(id);
      if (!r) throw new Error(`unknown reservation ${id}`);
      this._appendWAL({ op: "commit", id, actual: actualUsd });
      this.reservations.delete(id);
      this.cumulativeUsd += actualUsd;
      this._afterMutate();
    });
  }

  release(id) {
    return this._serialize(() => {
      if (!this.reservations.has(id)) return;
      this._appendWAL({ op: "release", id });
      this.reservations.delete(id);
      this._afterMutate();
    });
  }

  reapExpired() {
    return this._serialize(() => {
      this._reapExpiredInner();
      this._afterMutate();
    });
  }

  /** Called inside the mutex. */
  _reapExpiredInner() {
    const now = this.now();
    for (const [id, r] of this.reservations) {
      if (r.expiresAt <= now) {
        this._appendWAL({ op: "reap", id });
        this.reservations.delete(id);
      }
    }
  }

  _inFlightInner() {
    let sum = 0;
    for (const r of this.reservations.values()) sum += r.amountUsd;
    return sum;
  }

  // ============================================================
  // Target queue + fencing tokens
  // ============================================================

  seedTargets(targets) {
    return this._serialize(() => {
      for (const t of targets) {
        if (this.targets.has(t.id)) continue; // idempotent on replay
        const entry = {
          stage: t.stage,
          lane: t.lane,
          gen: 0,
          status: "pending",
          variantIds: [],
        };
        this._appendWAL({ op: "seedTarget", id: t.id, target: t });
        this.targets.set(t.id, entry);
        this.targetQueue.push(t.id);
      }
      this._afterMutate();
    });
  }

  popTarget(workerId) {
    return this._serialize(() => {
      if (this.phase === "phase3") return { error: "phase3" };
      while (this.targetQueue.length > 0) {
        const id = this.targetQueue.shift();
        const t = this.targets.get(id);
        if (!t || t.status !== "pending") continue;
        this._appendWAL({ op: "popTarget", id, workerId });
        return { target: { id, stage: t.stage, lane: t.lane }, gen: t.gen };
      }
      return { error: "empty" };
    });
  }

  bumpTargetGen(targetId) {
    return this._serialize(() => {
      const t = this.targets.get(targetId);
      if (!t) throw new Error(`unknown target ${targetId}`);
      t.gen += 1;
      t.status = "pending";
      this.targetQueue.push(targetId); // re-queue for retry
      this._appendWAL({ op: "bumpGen", id: targetId, newGen: t.gen });
      this._afterMutate();
      return t.gen;
    });
  }

  commitVariant(variantId, targetId, gen, scores, patchPath) {
    return this._serialize(() => {
      const t = this.targets.get(targetId);
      if (!t) throw new Error(`unknown target ${targetId}`);
      if (gen !== t.gen) return { error: "stale_gen" };
      if (this.variants.has(variantId)) return { error: "duplicate" };
      this._appendWAL({
        op: "commitVariant",
        variantId,
        targetId,
        gen,
        scores,
        patchPath,
      });
      this.variants.set(variantId, {
        targetId,
        gen,
        scores,
        patchPath,
        committedAt: this.now(),
      });
      t.variantIds.push(variantId);
      // If under the per-target variant cap, re-queue with a bumped gen so
      // another variant of the same target can be explored. Otherwise retire.
      // The bumped gen also serves as the fencing token for any in-flight
      // stale commit attempts on the previous gen.
      if (t.variantIds.length < this.maxVariantsPerTarget) {
        t.gen += 1;
        t.status = "pending";
        this.targetQueue.push(targetId);
      } else {
        t.status = "done";
      }
      this._afterMutate();
      return { ok: true };
    });
  }

  setPhase(phase) {
    return this._serialize(() => {
      this.phase = phase;
      this._appendWAL({ op: "setPhase", phase });
      this._afterMutate();
    });
  }

  // ============================================================
  // Telemetry
  // ============================================================

  status() {
    return this._serialize(() => ({
      cumulative: this.cumulativeUsd,
      cap: this.capUsd,
      in_flight: this._inFlightInner(),
      phase: this.phase,
      uptime: this.now() - this.startedAt,
      targets_pending: [...this.targets.values()].filter((t) => t.status === "pending").length,
      variants_committed: this.variants.size,
    }));
  }

  // ============================================================
  // Persistence: WAL + state snapshot
  // ============================================================

  _appendWAL(entry) {
    const line = JSON.stringify({ ts: this.now(), ...entry }) + "\n";
    appendFileSync(this.walFile, line);
  }

  _loadState() {
    if (!existsSync(this.stateFile)) return;
    try {
      const raw = readFileSync(this.stateFile, "utf-8");
      const s = JSON.parse(raw);
      this.cumulativeUsd = s.cumulativeUsd ?? 0;
      this.phase = s.phase ?? "seed";
      this._snapshotTs = s._snapshotTs ?? 0;
      if (s.reservations) {
        for (const [id, r] of Object.entries(s.reservations)) {
          this.reservations.set(id, r);
        }
      }
      if (s.targets) {
        for (const [id, t] of Object.entries(s.targets)) {
          this.targets.set(id, { ...t, variantIds: t.variantIds ?? [] });
          if (t.status === "pending") this.targetQueue.push(id);
        }
      }
      if (s.variants) {
        for (const [id, v] of Object.entries(s.variants)) {
          this.variants.set(id, v);
        }
      }
    } catch {
      // Snapshot corrupt; rely on WAL replay
      this._snapshotTs = 0;
    }
  }

  _replayWAL() {
    if (!existsSync(this.walFile)) return;
    const raw = readFileSync(this.walFile, "utf-8");
    const snapshotAt = this._snapshotTs ?? 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.ts && entry.ts <= snapshotAt) continue;
      this._applyWALEntry(entry);
    }
  }

  _applyWALEntry(e) {
    switch (e.op) {
      case "reserve":
        this.reservations.set(e.id, {
          amountUsd: e.amt,
          meta: e.meta ?? {},
          expiresAt: (e.ts ?? 0) + (e.ttl ?? 0),
          createdAt: e.ts ?? 0,
        });
        break;
      case "commit": {
        const r = this.reservations.get(e.id);
        if (r) {
          this.cumulativeUsd += e.actual;
          this.reservations.delete(e.id);
        }
        break;
      }
      case "release":
      case "reap":
        this.reservations.delete(e.id);
        break;
      case "seedTarget":
        if (!this.targets.has(e.id)) {
          this.targets.set(e.id, {
            stage: e.target.stage,
            lane: e.target.lane,
            gen: 0,
            status: "pending",
            variantIds: [],
          });
          this.targetQueue.push(e.id);
        }
        break;
      case "popTarget": {
        const t = this.targets.get(e.id);
        if (t) {
          const i = this.targetQueue.indexOf(e.id);
          if (i !== -1) this.targetQueue.splice(i, 1);
          t.status = "in_flight";
        }
        break;
      }
      case "bumpGen": {
        const t = this.targets.get(e.id);
        if (t) {
          t.gen = e.newGen;
          t.status = "pending";
          if (!this.targetQueue.includes(e.id)) this.targetQueue.push(e.id);
        }
        break;
      }
      case "commitVariant":
        this.variants.set(e.variantId, {
          targetId: e.targetId,
          gen: e.gen,
          scores: e.scores,
          patchPath: e.patchPath,
          committedAt: e.ts ?? 0,
        });
        {
          const t = this.targets.get(e.targetId);
          if (t) {
            t.variantIds.push(e.variantId);
            t.status = "done";
          }
        }
        break;
      case "setPhase":
        this.phase = e.phase;
        break;
    }
  }

  _afterMutate() {
    this._opsSincePersist++;
    if (this._opsSincePersist >= this.persistEvery) {
      this._persistStateSync();
    }
  }

  _persistStateSync() {
    const snapshot = {
      cumulativeUsd: this.cumulativeUsd,
      capUsd: this.capUsd,
      phase: this.phase,
      reservations: Object.fromEntries(this.reservations),
      targets: Object.fromEntries(this.targets),
      variants: Object.fromEntries(this.variants),
      _snapshotTs: this.now(),
    };
    const tmp = this.stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    renameSync(tmp, this.stateFile);
    this._opsSincePersist = 0;
  }

  // ============================================================
  // Unix socket server
  // ============================================================

  async _startSocket() {
    if (!this.socketPath) return;
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {}
    }
    this._server = createServer((conn) => {
      let buf = "";
      conn.on("data", async (chunk) => {
        buf += chunk.toString("utf-8");
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          let req;
          try {
            req = JSON.parse(line);
          } catch {
            conn.write(JSON.stringify({ error: "bad_json" }) + "\n");
            continue;
          }
          const resp = await this._dispatch(req);
          conn.write(JSON.stringify(resp) + "\n");
        }
      });
      conn.on("error", () => {});
    });
    await new Promise((resolve, reject) => {
      this._server.once("error", reject);
      this._server.listen(this.socketPath, () => resolve());
    });
  }

  async _stopSocket() {
    if (!this._server) return;
    await new Promise((resolve) => this._server.close(resolve));
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {}
    }
    this._server = null;
  }

  async _dispatch(req) {
    const { method, id, params = {} } = req;
    try {
      let result;
      switch (method) {
        case "ping":
          result = "pong";
          break;
        case "reserve":
          result = await this.reserve(params.amountUsd, params.meta ?? {}, params.ttlMs);
          break;
        case "commit":
          await this.commit(params.id, params.actualUsd);
          result = { ok: true };
          break;
        case "release":
          await this.release(params.id);
          result = { ok: true };
          break;
        case "popTarget":
          result = await this.popTarget(params.workerId);
          break;
        case "bumpTargetGen":
          result = await this.bumpTargetGen(params.targetId);
          break;
        case "commitVariant":
          result = await this.commitVariant(
            params.variantId,
            params.targetId,
            params.gen,
            params.scores,
            params.patchPath,
          );
          break;
        case "status":
          result = await this.status();
          break;
        default:
          return { id, error: `unknown_method:${method}` };
      }
      return { id, result };
    } catch (e) {
      return { id, error: String(e.message || e) };
    }
  }
}
