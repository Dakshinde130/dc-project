/**
 * BackendManager — spawns three real Node HTTP server processes
 * (scripts/backend-server.js) on ports 4101–4103 and supervises them.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { getGlobal } from "./store";

/** Euthanize orphaned copies of a lab script from older server lifecycles. */
export function prekill(pattern: string): Promise<void> {
  return new Promise((resolve) => {
    execFile("pkill", ["-f", pattern], () => resolve()); // exit 1 = none matched
  });
}

export interface BackendProc {
  id: string;
  port: number;
  proc: ChildProcess | null;
  /** artificial latency currently configured on this backend */
  delayMs: number;
  /** LB-side counters */
  active: number;
  routed: number;
  completed: number;
  failed: number;
  totalLatencyMs: number;
  lastLatencyMs: number | null;
  /** last pid observed via health check */
  pid: number | null;
  lastHealthOk: boolean;
  reportedServed: number;
  respawnAttempts: number;
}

const BACKEND_DEFS = [
  { id: "BE-4101", port: 4101 },
  { id: "BE-4102", port: 4102 },
  { id: "BE-4103", port: 4103 },
];

export class BackendManager {
  backends: BackendProc[] = BACKEND_DEFS.map((d) => ({
    ...d,
    proc: null,
    delayMs: 0,
    active: 0,
    routed: 0,
    completed: 0,
    failed: 0,
    totalLatencyMs: 0,
    lastLatencyMs: null,
    pid: null,
    lastHealthOk: false,
    reportedServed: 0,
    respawnAttempts: 0,
  }));

  private starting: Promise<void> | null = null;
  private scriptPath = path.join(process.cwd(), "scripts", "backend-server.js");

  ensureStarted(): Promise<void> {
    if (!this.starting) {
      this.starting = this.spawnAll().catch((e) => {
        this.starting = null;
        throw e;
      });
    }
    return this.starting;
  }

  private async spawnAll(): Promise<void> {
    // clear any orphans from a previous server lifecycle holding our ports
    await prekill("backend-server.js --id BE-");
    await sleep(150);
    for (const b of this.backends) this.spawnOne(b);
    await Promise.all(this.backends.map((b) => this.waitReady(b, 6000)));
  }

  private spawnOne(b: BackendProc): void {
    if (b.proc && b.proc.exitCode === null) return;
    const child = spawn(
      process.execPath,
      [this.scriptPath, "--id", b.id, "--port", String(b.port)],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    b.proc = child;
    child.stdout?.on("data", (d) => {
      process.stdout.write(`[backend] ${String(d).trim()}\n`);
    });
    child.stderr?.on("data", (d) => {
      process.stderr.write(`[backend:${b.id}] ${String(d).trim()}\n`);
    });
    child.on("exit", () => {
      b.proc = null;
      // Auto-respawn: a distributed system should tolerate process crashes.
      if (b.respawnAttempts < 5) {
        b.respawnAttempts++;
        setTimeout(() => {
          try {
            this.spawnOne(b);
          } catch {
            /* surfaced via health checks */
          }
        }, 600);
      }
    });
  }

  private async waitReady(b: BackendProc, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.ping(b, 400);
      if (ok) return;
      await sleep(120);
    }
    throw new Error(`backend ${b.id} failed to start on port ${b.port}`);
  }

  private async ping(b: BackendProc, timeoutMs = 700): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${b.port}/healthz`, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as {
        pid: number;
        served: number;
        delayMs: number;
      };
      b.pid = j.pid;
      b.reportedServed = j.served;
      b.delayMs = j.delayMs;
      b.lastHealthOk = true;
      return true;
    } catch {
      b.lastHealthOk = false;
      return false;
    }
  }

  /** Refresh health + pid + self-reported counters for all backends. */
  async refresh(): Promise<void> {
    await this.ensureStarted();
    await Promise.all(this.backends.map((b) => this.ping(b)));
  }

  /** Execute one real HTTP request against a backend. */
  async callWork(b: BackendProc): Promise<{ latencyMs: number; body: { seq?: number; pid?: number } }> {
    b.active++;
    b.routed++;
    const t0 = performance.now();
    try {
      const res = await fetch(`http://127.0.0.1:${b.port}/work`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      const body = (await res.json()) as { seq?: number; pid?: number };
      b.completed++;
      b.totalLatencyMs += latencyMs;
      b.lastLatencyMs = latencyMs;
      return { latencyMs, body };
    } catch (e) {
      b.failed++;
      throw e;
    } finally {
      b.active--;
    }
  }

  async setDelay(id: string, delayMs: number): Promise<boolean> {
    await this.ensureStarted();
    const b = this.backends.find((x) => x.id === id);
    if (!b) return false;
    try {
      await fetch(`http://127.0.0.1:${b.port}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delayMs }),
        cache: "no-store",
      });
      b.delayMs = delayMs;
      return true;
    } catch {
      return false;
    }
  }

  async resetStats(): Promise<void> {
    for (const b of this.backends) {
      b.active = 0;
      b.routed = 0;
      b.completed = 0;
      b.failed = 0;
      b.totalLatencyMs = 0;
      b.lastLatencyMs = null;
      b.reportedServed = 0;
      try {
        await fetch(`http://127.0.0.1:${b.port}/reset`, { method: "POST", cache: "no-store" });
      } catch {
        /* backend may be down; health check will reflect it */
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function getBackendManager(): BackendManager {
  return getGlobal("dslab.backendManager", () => new BackendManager());
}
