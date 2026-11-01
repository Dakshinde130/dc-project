/**
 * Comms layer — managers for two real satellite processes:
 *  - TCP broker  (scripts/tcp-server.js on :5101) via node:net sockets
 *  - UDP notifier (scripts/udp-notifier.js ⇄ :5201/:5202) via node:dgram
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import dgram from "node:dgram";
import path from "node:path";
import { getGlobal } from "./store";
import { prekill } from "./backends";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ================================ TCP ==================================== */

export interface TcpSendResult {
  id: number;
  mode: "fresh" | "pooled";
  rttMs: number;
  bytes: number;
  serverSeq: number;
  ok: boolean;
  error?: string;
}

interface TcpStats {
  started: boolean;
  pid: number | null;
  sent: number;
  sentFresh: number;
  sentPooled: number;
  errors: number;
  avgRttFresh: number | null;
  avgRttPooled: number | null;
  lastRtts: { mode: "fresh" | "pooled"; ms: number }[];
  broker: Record<string, number> | null;
}

class TcpManager {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private poolSock: net.Socket | null = null;
  private poolBuf = "";
  private busy: {
    id: number;
    t0: number;
    resolve: (r: TcpSendResult) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private queue: { id: number; payload: string; t0: number; resolve: (r: TcpSendResult) => void; reject: (e: Error) => void }[] = [];

  private idSeq = 0;
  private sent = 0;
  private sentFresh = 0;
  private sentPooled = 0;
  private errors = 0;
  private rttsFresh: number[] = [];
  private rttsPooled: number[] = [];
  private lastRtts: { mode: "fresh" | "pooled"; ms: number }[] = [];

  private scriptPath(name: string) {
    return path.join(process.cwd(), "scripts", name);
  }

  ensure(): Promise<void> {
    if (!this.starting) {
      this.starting = (async () => {
        await prekill("tcp-server.js --port 5101");
        await sleep(150);
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [this.scriptPath("tcp-server.js"), "--port", "5101"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.child = child;
        const to = setTimeout(() => reject(new Error("tcp broker start timeout")), 6000);
        child.stdout?.on("data", (d) => {
          const s = String(d);
          process.stdout.write(`[tcp] ${s.trim()}\n`);
          if (s.includes("TCP-LISTENING")) {
            clearTimeout(to);
            resolve();
          }
        });
        child.on("exit", () => {
          this.child = null;
          this.starting = null;
          this.poolSock = null;
        });
        });
      })();
    }
    return this.starting;
  }

  private async pooled(id: number, payload: string): Promise<TcpSendResult> {
    const t0 = performance.now();
    return new Promise<TcpSendResult>((resolve, reject) => {
      this.queue.push({ id, payload, t0, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    if (this.busy || this.queue.length === 0) return;
    const task = this.queue.shift()!;
    const write = () => {
      const timer = setTimeout(() => {
        this.busy = null;
        task.reject(new Error("broker timeout"));
        this.pump();
      }, 4000);
      this.busy = { id: task.id, t0: task.t0, resolve: task.resolve, reject: task.reject, timer };
      this.poolSock!.write(`MSG|${task.id}|${task.payload}\n`);
    };
    if (this.poolSock && !this.poolSock.destroyed) {
      write();
    } else {
      const sock = net.connect(5101, "127.0.0.1");
      this.poolBuf = "";
      sock.on("connect", () => {
        this.poolSock = sock;
        write();
      });
      sock.on("data", (d) => this.onPoolData(d));
      sock.on("error", () => undefined);
      sock.on("close", () => {
        this.poolSock = null;
      });
    }
  }

  private onPoolData(d: Buffer) {
    this.poolBuf += d.toString("utf8");
    let idx;
    while ((idx = this.poolBuf.indexOf("\n")) >= 0) {
      const line = this.poolBuf.slice(0, idx).trim();
      this.poolBuf = this.poolBuf.slice(idx + 1);
      const cur = this.busy;
      if (!cur) continue;
      if (line.startsWith("ACK|")) {
        clearTimeout(cur.timer);
        this.busy = null;
        const parts = line.split("|");
        const rttMs = Math.max(0.1, Math.round((performance.now() - cur.t0) * 100) / 100);
        cur.resolve({ id: cur.id, mode: "pooled", rttMs, bytes: Number(parts[2]) || 0, serverSeq: Number(parts[3]) || 0, ok: true });
        this.pump();
      } else if (line.startsWith("ERR")) {
        clearTimeout(cur.timer);
        this.busy = null;
        cur.reject(new Error(line));
        this.pump();
      }
    }
  }

  private fresh(id: number, payload: string): Promise<TcpSendResult> {
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const sock = net.connect(5101, "127.0.0.1");
      let buf = "";
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("broker timeout"));
      }, 4000);
      sock.on("connect", () => sock.write(`MSG|${id}|${payload}\n`));
      sock.on("data", (d) => {
        buf += d.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          clearTimeout(timer);
          sock.end();
          sock.destroy();
          if (line.startsWith("ACK|")) {
            const parts = line.split("|");
            const rttMs = Math.max(0.1, Math.round((performance.now() - t0) * 100) / 100);
            resolve({ id, mode: "fresh", rttMs, bytes: Number(parts[2]) || 0, serverSeq: Number(parts[3]) || 0, ok: true });
          } else {
            reject(new Error(line || "bad reply"));
          }
        }
      });
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  async send(payload: string, pooled: boolean): Promise<TcpSendResult> {
    await this.ensure();
    const id = ++this.idSeq;
    try {
      const r = pooled ? await this.pooled(id, payload) : await this.fresh(id, payload);
      this.sent++;
      if (pooled) {
        this.sentPooled++;
        this.rttsPooled.push(r.rttMs);
        if (this.rttsPooled.length > 100) this.rttsPooled.shift();
      } else {
        this.sentFresh++;
        this.rttsFresh.push(r.rttMs);
        if (this.rttsFresh.length > 100) this.rttsFresh.shift();
      }
      this.lastRtts.push({ mode: pooled ? "pooled" : "fresh", ms: r.rttMs });
      if (this.lastRtts.length > 60) this.lastRtts.shift();
      return r;
    } catch (e) {
      this.errors++;
      return { id, mode: pooled ? "pooled" : "fresh", rttMs: 0, bytes: 0, serverSeq: 0, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private avg(a: number[]) {
    return a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100 : null;
  }

  async brokerStats(): Promise<Record<string, number> | null> {
    try {
      await this.ensure();
      return await new Promise((resolve) => {
        const sock = net.connect(5101, "127.0.0.1");
        let buf = "";
        const timer = setTimeout(() => {
          sock.destroy();
          resolve(null);
        }, 3000);
        sock.on("connect", () => sock.write("STATS\n"));
        sock.on("data", (d) => {
          buf += d.toString("utf8");
          const m = buf.indexOf("STATS|");
          const nl = buf.indexOf("\n");
          if (m >= 0 && nl > m) {
            clearTimeout(timer);
            sock.destroy();
            try {
              resolve(JSON.parse(buf.slice(m + 6, nl)));
            } catch {
              resolve(null);
            }
          }
        });
        sock.on("error", () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  async getStats(): Promise<TcpStats> {
    await this.ensure();
    const broker = await this.brokerStats();
    return {
      started: true,
      pid: this.child?.pid ?? null,
      sent: this.sent,
      sentFresh: this.sentFresh,
      sentPooled: this.sentPooled,
      errors: this.errors,
      avgRttFresh: this.avg(this.rttsFresh),
      avgRttPooled: this.avg(this.rttsPooled),
      lastRtts: [...this.lastRtts],
      broker,
    };
  }

  reset() {
    this.sent = 0;
    this.sentFresh = 0;
    this.sentPooled = 0;
    this.errors = 0;
    this.rttsFresh = [];
    this.rttsPooled = [];
    this.lastRtts = [];
  }
}

/* ================================ UDP ==================================== */

export interface UdpEvent {
  n: number;
  seq: number;
  kind: string;
  value: string | number;
  latencyMs: number;
  gapLost: number;
  ts: number;
}

class UdpManager {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private rx: dgram.Socket | null = null;
  private ctl: dgram.Socket | null = null;
  private listeners = new Set<(e: UdpEvent) => void>();
  private events: UdpEvent[] = [];
  private n = 0;
  private lastSeq = 0;
  private rxCount = 0;
  private lostEst = 0;
  private byKind: Record<string, number> = {};
  private lastLatencyMs = 0;
  cfg = { rateMs: 220, lossPct: 10, running: false };
  private notifiedPid: number | null = null;

  private scriptPath(name: string) {
    return path.join(process.cwd(), "scripts", name);
  }

  ensure(): Promise<void> {
    if (!this.starting) {
      this.starting = (async () => {
        await prekill("udp-notifier.js --target 5201");
        await sleep(150);
        await new Promise<void>((resolve, reject) => {
        // receiver socket first
        if (!this.rx) {
          this.rx = dgram.createSocket("udp4");
          this.rx.on("message", (msg) => this.onDatagram(msg));
          this.rx.on("error", () => undefined);
          this.rx.bind(5201, "127.0.0.1");
        }
        if (!this.ctl) {
          this.ctl = dgram.createSocket("udp4");
          this.ctl.on("error", () => undefined);
        }
        const child = spawn(process.execPath, [this.scriptPath("udp-notifier.js"), "--target", "5201", "--control", "5202"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.child = child;
        this.notifiedPid = child.pid ?? null;
        const to = setTimeout(() => reject(new Error("udp notifier start timeout")), 6000);
        child.stdout?.on("data", (d) => {
          const s = String(d);
          process.stdout.write(`[udp] ${s.trim()}\n`);
          if (s.includes("UDP-READY")) {
            clearTimeout(to);
            resolve();
          }
        });
        child.on("exit", () => {
          this.child = null;
          this.starting = null;
          this.notifiedPid = null;
        });
        });
      })();
    }
    return this.starting;
  }

  private onDatagram(msg: Buffer) {
    try {
      const j = JSON.parse(msg.toString("utf8")) as { seq: number; kind: string; value: string | number; ts: number };
      const gapLost = this.lastSeq > 0 ? Math.max(0, j.seq - this.lastSeq - 1) : 0;
      this.lastSeq = j.seq;
      this.rxCount++;
      this.lostEst += gapLost;
      this.byKind[j.kind] = (this.byKind[j.kind] || 0) + 1;
      this.lastLatencyMs = Math.max(0, Date.now() - j.ts);
      const ev: UdpEvent = {
        n: ++this.n,
        seq: j.seq,
        kind: j.kind,
        value: j.value,
        latencyMs: this.lastLatencyMs,
        gapLost,
        ts: Date.now(),
      };
      this.events.push(ev);
      if (this.events.length > 90) this.events.shift();
      for (const fn of this.listeners) fn(ev);
    } catch {
      /* malformed datagram */
    }
  }

  async configure(patch: Partial<{ rateMs: number; lossPct: number; running: boolean; reset: boolean }>): Promise<void> {
    await this.ensure();
    Object.assign(this.cfg, patch);
    if (patch.reset) {
      this.lastSeq = 0;
      this.rxCount = 0;
      this.lostEst = 0;
      this.byKind = {};
      this.events = [];
    }
    const buf = Buffer.from(JSON.stringify(patch));
    await new Promise<void>((resolve) => {
      this.ctl!.send(buf, 0, buf.length, 5202, "127.0.0.1", () => resolve());
    });
  }

  subscribe(fn: (e: UdpEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStats() {
    return {
      pid: this.notifiedPid,
      running: this.cfg.running,
      rateMs: this.cfg.rateMs,
      lossPct: this.cfg.lossPct,
      rx: this.rxCount,
      lostEst: this.lostEst,
      lastSeq: this.lastSeq,
      lastLatencyMs: this.lastLatencyMs,
      byKind: { ...this.byKind },
      events: [...this.events.slice(-40)],
    };
  }
}

export function getTcpManager(): TcpManager {
  return getGlobal("dslab.tcp", () => new TcpManager());
}
export function getUdpManager(): UdpManager {
  return getGlobal("dslab.udp", () => new UdpManager());
}
