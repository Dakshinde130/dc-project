/**
 * BerkeleyLab — Berkeley clock synchronization.
 *
 * Each worker process keeps its own DRIFTING logical clock
 * (offset + drift in ppm). The coordinator polls all clocks, computes the
 * average (fault-tolerant in spirit: ignores unreadable nodes), and sends
 * each node an adjustment. Spread should collapse after every round.
 */
import { getBackendManager } from "./backends";
import { getGlobal } from "./store";

export interface ClockReading {
  id: string;
  pid: number | null;
  clock: number;
  driftPpm: number;
  offsetMs: number;
  adjustMs: number;
  offsetVsCoordinator: number;
  ok: boolean;
}

export interface BerkeleyRound {
  round: number;
  ts: number;
  avgClock: number;
  spreadBeforeMs: number;
  spreadAfterMs: number | null;
  adjustments: Record<string, number>;
}

class BerkeleyLab {
  round = 0;
  history: { round: number; ts: number; spreadMs: number }[] = [];
  lastRound: BerkeleyRound | null = null;
  auto = false;
  autoMs = 4000;
  private timer: ReturnType<typeof setInterval> | null = null;

  async readClocks(): Promise<{ coordinator: number; nodes: ClockReading[] }> {
    const mgr = getBackendManager();
    await mgr.ensureStarted();
    const coordinator = Date.now();
    const nodes = await Promise.all(
      mgr.backends.map(async (b) => {
        try {
          const r = await fetch(`http://127.0.0.1:${b.port}/clock`, {
            cache: "no-store",
            signal: AbortSignal.timeout(1500),
          });
          const j = (await r.json()) as {
            clock: number;
            driftPpm: number;
            offsetMs: number;
            adjustMs: number;
            pid: number;
          };
          return {
            id: b.id,
            pid: j.pid,
            clock: j.clock,
            driftPpm: j.driftPpm,
            offsetMs: j.offsetMs,
            adjustMs: j.adjustMs,
            offsetVsCoordinator: Math.round((j.clock - coordinator) * 10) / 10,
            ok: true,
          };
        } catch {
          return { id: b.id, pid: null, clock: 0, driftPpm: 0, offsetMs: 0, adjustMs: 0, offsetVsCoordinator: 0, ok: false };
        }
      })
    );
    return { coordinator, nodes };
  }

  /** One full Berkeley round: poll → average → adjust → re-poll. */
  async sync(): Promise<BerkeleyRound> {
    const mgr = getBackendManager();
    const { coordinator, nodes } = await this.readClocks();
    const good = nodes.filter((n) => n.ok);
    const clocks = [coordinator, ...good.map((n) => n.clock)];
    const avg = clocks.reduce((s, c) => s + c, 0) / clocks.length;
    const spreadBefore = good.length > 0 ? Math.max(...clocks) - Math.min(...clocks) : 0;

    const adjustments: Record<string, number> = {};
    await Promise.all(
      good.map(async (n) => {
        const delta = Math.round((avg - n.clock) * 10) / 10;
        adjustments[n.id] = delta;
        try {
          await fetch(`http://127.0.0.1:${mgr.backends.find((b) => b.id === n.id)!.port}/clock/adjust`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delta }),
            cache: "no-store",
          });
        } catch {
          /* node died mid-round — Berkeley tolerates it */
        }
      })
    );

    // re-poll to prove convergence
    const after = await this.readClocks();
    const afterClocks = [Date.now(), ...after.nodes.filter((n) => n.ok).map((n) => n.clock)];
    const spreadAfter = afterClocks.length > 1 ? Math.max(...afterClocks) - Math.min(...afterClocks) : null;

    this.round++;
    const round: BerkeleyRound = {
      round: this.round,
      ts: Date.now(),
      avgClock: Math.round(avg),
      spreadBeforeMs: Math.round(spreadBefore * 10) / 10,
      spreadAfterMs: spreadAfter === null ? null : Math.round(spreadAfter * 10) / 10,
      adjustments,
    };
    this.lastRound = round;
    this.history.push({ round: this.round, ts: round.ts, spreadMs: round.spreadBeforeMs });
    if (this.history.length > 48) this.history.shift();
    return round;
  }

  async setDrift(id: string, ppm: number): Promise<void> {
    const mgr = getBackendManager();
    await mgr.ensureStarted();
    const b = mgr.backends.find((x) => x.id === id);
    if (!b) return;
    await fetch(`http://127.0.0.1:${b.port}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driftPpm: ppm }),
      cache: "no-store",
    }).catch(() => undefined);
  }

  setAuto(on: boolean, ms?: number) {
    if (ms) this.autoMs = Math.max(1500, Math.min(15000, ms));
    if (on === this.auto) return;
    this.auto = on;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (on) {
      this.timer = setInterval(() => {
        void this.sync().catch(() => undefined);
      }, this.autoMs);
    }
  }

  async resetTotals() {
    const mgr = getBackendManager();
    await mgr.ensureStarted();
    await Promise.all(
      mgr.backends.map((b) =>
        fetch(`http://127.0.0.1:${b.port}/reset`, { method: "POST", cache: "no-store" }).catch(() => undefined)
      )
    );
    this.history = [];
    this.lastRound = null;
    this.round = 0;
  }
}

export function getBerkeleyLab(): BerkeleyLab {
  return getGlobal("dslab.berkeley", () => new BerkeleyLab());
}
