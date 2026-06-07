/**
 * BudgetClient — worker-side socket client for BudgetBroker. Sends JSON-RPC
 * requests over a Unix socket with line-delimited framing. Auto-reconnects on
 * ECONNREFUSED with exponential backoff.
 */

import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

export class BudgetExceededError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "BudgetExceededError";
  }
}
export class StaleGenError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "StaleGenError";
  }
}

export class BudgetClient {
  constructor(socketPath, opts = {}) {
    this.socketPath = socketPath;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 8;
    this._conn = null;
    this._buf = "";
    this._pending = new Map(); // id -> { resolve, reject, timer }
    this._connectP = null;
  }

  async _connect() {
    if (this._conn) return;
    if (this._connectP) return this._connectP;
    this._connectP = (async () => {
      let attempt = 0;
      while (attempt <= this.maxReconnectAttempts) {
        try {
          await new Promise((resolve, reject) => {
            const c = createConnection(this.socketPath, () => {
              this._conn = c;
              this._attachHandlers(c);
              resolve();
            });
            c.once("error", reject);
          });
          this._connectP = null;
          return;
        } catch (e) {
          attempt += 1;
          if (attempt > this.maxReconnectAttempts) {
            this._connectP = null;
            throw e;
          }
          const delay = Math.min(2000, 50 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    })();
    return this._connectP;
  }

  _attachHandlers(conn) {
    conn.on("data", (chunk) => {
      this._buf += chunk.toString("utf-8");
      let idx;
      while ((idx = this._buf.indexOf("\n")) !== -1) {
        const line = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + 1);
        if (!line.trim()) continue;
        let resp;
        try {
          resp = JSON.parse(line);
        } catch {
          continue;
        }
        const pending = this._pending.get(resp.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this._pending.delete(resp.id);
        if (resp.error != null) pending.reject(new Error(resp.error));
        else pending.resolve(resp.result);
      }
    });
    conn.on("close", () => {
      this._conn = null;
      for (const [, p] of this._pending) {
        clearTimeout(p.timer);
        p.reject(new Error("connection_closed"));
      }
      this._pending.clear();
    });
    conn.on("error", () => {});
  }

  async _rpc(method, params) {
    await this._connect();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`rpc_timeout:${method}`));
      }, this.timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      try {
        this._conn.write(JSON.stringify({ method, id, params }) + "\n");
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(e);
      }
    });
  }

  async ping() {
    return this._rpc("ping", {});
  }

  /** Returns reservation id. Throws BudgetExceededError on insufficient budget. */
  async reserve(amountUsd, meta = {}, ttlMs = 5 * 60 * 1000) {
    const r = await this._rpc("reserve", { amountUsd, meta, ttlMs });
    if (r && r.error === "exceeded") throw new BudgetExceededError("cap reached");
    if (r && r.error) throw new Error(r.error);
    return r.id;
  }

  async commit(id, actualUsd) {
    await this._rpc("commit", { id, actualUsd });
  }

  async release(id) {
    await this._rpc("release", { id });
  }

  async popTarget(workerId) {
    const r = await this._rpc("popTarget", { workerId });
    if (r && r.error === "empty") return null;
    if (r && r.error === "phase3") return { phase3: true };
    if (r && r.error) throw new Error(r.error);
    return r;
  }

  async bumpTargetGen(targetId) {
    return this._rpc("bumpTargetGen", { targetId });
  }

  async commitVariant(variantId, targetId, gen, scores, patchPath) {
    const r = await this._rpc("commitVariant", {
      variantId,
      targetId,
      gen,
      scores,
      patchPath,
    });
    if (r && r.error === "stale_gen") throw new StaleGenError("stale generation");
    if (r && r.error) throw new Error(r.error);
    return r;
  }

  async status() {
    return this._rpc("status", {});
  }

  async disconnect() {
    if (this._conn) {
      this._conn.end();
      this._conn = null;
    }
  }
}
