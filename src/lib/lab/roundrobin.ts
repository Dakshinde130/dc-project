/** Strict Round Robin router over the three real HTTP worker processes. */
import { getBackendManager } from "./backends";
import { getGlobal } from "./store";

export interface RoundRobinDecision {
  seq: number;
  slot: number;
  backendId: string;
  port: number;
  pid: number | null;
  latencyMs: number;
  backendSeq: number | null;
  ok: boolean;
  ts: number;
}

class RoundRobinLab {
  cursor = 0;
  seq = 0;
  counts: Record<string, number> = { "BE-4101": 0, "BE-4102": 0, "BE-4103": 0 };
  history: RoundRobinDecision[] = [];
  slowId: string | null = null;

  async route(): Promise<RoundRobinDecision> {
    const mgr = getBackendManager();
    await mgr.ensureStarted();
    const slot = this.cursor % mgr.backends.length;
    this.cursor++;
    const backend = mgr.backends[slot];
    const seq = ++this.seq;
    const ts = Date.now();
    try {
      const r = await mgr.callWork(backend);
      this.counts[backend.id] = (this.counts[backend.id] ?? 0) + 1;
      const item: RoundRobinDecision = {
        seq,
        slot,
        backendId: backend.id,
        port: backend.port,
        pid: r.body.pid ?? backend.pid,
        latencyMs: r.latencyMs,
        backendSeq: r.body.seq ?? null,
        ok: true,
        ts,
      };
      this.history.push(item);
      if (this.history.length > 90) this.history.shift();
      return item;
    } catch {
      const item: RoundRobinDecision = { seq, slot, backendId: backend.id, port: backend.port, pid: backend.pid, latencyMs: 0, backendSeq: null, ok: false, ts };
      this.history.push(item);
      return item;
    }
  }

  async status() {
    const mgr = getBackendManager();
    await mgr.refresh();
    return {
      cursor: this.cursor,
      seq: this.seq,
      counts: { ...this.counts },
      history: [...this.history],
      slowId: this.slowId,
      backends: mgr.backends.map((b) => ({ id: b.id, port: b.port, pid: b.pid, alive: b.lastHealthOk, active: b.active, delayMs: b.delayMs })),
    };
  }

  async setSlow(on: boolean) {
    const mgr = getBackendManager();
    await mgr.setDelay("BE-4102", on ? 900 : 0);
    this.slowId = on ? "BE-4102" : null;
  }

  async reset() {
    this.cursor = 0;
    this.seq = 0;
    this.counts = { "BE-4101": 0, "BE-4102": 0, "BE-4103": 0 };
    this.history = [];
    await getBackendManager().resetStats();
  }
}

export function getRoundRobinLab(): RoundRobinLab {
  return getGlobal("dslab.roundrobin", () => new RoundRobinLab());
}
