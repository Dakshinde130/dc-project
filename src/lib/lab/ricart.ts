/**
 * RicartAgrawala — decentralized mutual exclusion (1981).
 *
 * No central lock: to enter the critical section a node broadcasts
 * REQUEST(lamportTs) to all others and may enter only after all REPLY.
 * A node defers its REPLY if it holds the section or is itself requesting
 * with an earlier (Lamport, id) timestamp. On exit, deferred replies flush.
 *
 * Implemented as three real async actors exchanging messages with real
 * (simulated-latency) sends — Lamport clocks tick on every event.
 */
import { getGlobal } from "./store";

export type RAStatus = "idle" | "requesting" | "holding";

export interface RAEvent {
  n: number;
  atMs: number;
  kind: "request" | "reply" | "defer" | "enter" | "exit";
  from: number;
  to: number | null;
  ts: number;
  text: string;
}

export interface RANodeState {
  id: number;
  lamport: number;
  status: RAStatus;
  wantTs: number | null;
  deferred: number[];
  repliesFrom: number[];
  entries: number;
  holdUntilMs: number | null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

class RicartAgrawala {
  readonly N = 3;
  nodes: RANodeState[] = [];
  events: RAEvent[] = [];
  auto = false;
  speed: "slow" | "normal" | "fast" = "normal";
  private n = 0;
  private t0 = Date.now();
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private runningGeneration = 0;

  constructor() {
    this.reset();
  }

  private mult() {
    return this.speed === "slow" ? 2.2 : this.speed === "fast" ? 0.45 : 1;
  }
  private netLatency() {
    return (60 + Math.random() * 90) * this.mult();
  }
  private holdTime() {
    return (700 + Math.random() * 700) * this.mult();
  }

  private emit(e: Omit<RAEvent, "n" | "atMs">) {
    this.events.push({ ...e, n: ++this.n, atMs: Date.now() - this.t0 });
    if (this.events.length > 140) this.events.shift();
  }

  reset() {
    this.runningGeneration++;
    this.nodes = Array.from({ length: this.N }, (_, i) => ({
      id: i,
      lamport: 0,
      status: "idle" as RAStatus,
      wantTs: null,
      deferred: [],
      repliesFrom: [],
      entries: 0,
      holdUntilMs: null,
    }));
    this.events = [];
    this.n = 0;
    this.t0 = Date.now();
    this.setAuto(false);
    this.emit({ kind: "request", from: -1, to: null, ts: 0, text: "protocol initialized — 3 nodes, no coordinator, Lamport clocks at 0" });
  }

  setAuto(on: boolean) {
    this.auto = on;
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    if (on) {
      const gen = this.runningGeneration;
      this.autoTimer = setInterval(() => {
        if (gen !== this.runningGeneration) return;
        const idle = this.nodes.filter((n) => n.status === "idle");
        if (idle.length > 0 && Math.random() < 0.75) {
          const pick = idle[Math.floor(Math.random() * idle.length)];
          void this.requestCS(pick.id, gen);
        }
      }, 640 * this.mult());
    }
  }

  setSpeed(s: "slow" | "normal" | "fast") {
    this.speed = s;
  }

  /** A node expresses intent to enter the critical section. */
  async requestCS(id: number, gen = this.runningGeneration): Promise<void> {
    const node = this.nodes[id];
    if (!node || node.status !== "idle") return;
    node.status = "requesting";
    node.lamport++;
    node.wantTs = node.lamport;
    node.repliesFrom = [];
    this.emit({ kind: "request", from: id, to: null, ts: node.wantTs, text: `N${id + 1} broadcasts REQUEST(ts=${node.wantTs}) to all` });
    // real async sends with network-ish latency
    await Promise.all(
      this.nodes
        .filter((o) => o.id !== id)
        .map(async (o) => {
          await sleep(this.netLatency());
          if (gen === this.runningGeneration) this.onRequest(o.id, { from: id, ts: node.wantTs! });
        })
    );
  }

  /** Recipient side of a REQUEST message. */
  private onRequest(at: number, msg: { from: number; ts: number }) {
    const node = this.nodes[at];
    node.lamport = Math.max(node.lamport, msg.ts) + 1;
    const selfFirst =
      node.status === "requesting" &&
      node.wantTs !== null &&
      (node.wantTs < msg.ts || (node.wantTs === msg.ts && node.id < msg.from));
    if (node.status === "holding" || selfFirst) {
      node.deferred.push(msg.from);
      this.emit({
        kind: "defer",
        from: at,
        to: msg.from,
        ts: node.lamport,
        text: `N${at + 1} defers N${msg.from + 1} (${node.status === "holding" ? "holding CS" : `own ts=${node.wantTs} < ${msg.ts}`})`,
      });
      return;
    }
    this.emit({ kind: "reply", from: at, to: msg.from, ts: node.lamport, text: `N${at + 1} → REPLY → N${msg.from + 1}` });
    void sleep(this.netLatency()).then(() => this.onReply(msg.from, at));
  }

  /** Requester side of a REPLY message. */
  private onReply(at: number, from: number) {
    const node = this.nodes[at];
    if (node.status !== "requesting") return;
    node.lamport++;
    if (!node.repliesFrom.includes(from)) node.repliesFrom.push(from);
    if (node.repliesFrom.length === this.N - 1) {
      // all replies collected → enter
      const delay = 30 * this.mult();
      const gen = this.runningGeneration;
      void sleep(delay).then(() => {
        if (gen === this.runningGeneration) this.enterCS(at);
      });
    }
  }

  private enterCS(id: number) {
    const node = this.nodes[id];
    node.status = "holding";
    node.entries++;
    const hold = this.holdTime();
    node.holdUntilMs = Date.now() - this.t0 + Math.round(hold);
    this.emit({ kind: "enter", from: id, to: null, ts: node.lamport, text: `N${id + 1} ENTERS critical section (hold ≈ ${Math.round(hold)}ms)` });
    const gen = this.runningGeneration;
    void sleep(hold).then(() => {
      if (gen === this.runningGeneration) this.exitCS(id);
    });
  }

  private exitCS(id: number) {
    const node = this.nodes[id];
    node.status = "idle";
    node.wantTs = null;
    node.holdUntilMs = null;
    node.lamport++;
    this.emit({ kind: "exit", from: id, to: null, ts: node.lamport, text: `N${id + 1} exits CS — flushing ${node.deferred.length} deferred REPLY` });
    const deferred = [...node.deferred];
    node.deferred = [];
    for (const d of deferred) {
      void sleep(this.netLatency() * 0.6).then(() => {
        this.emit({ kind: "reply", from: id, to: d, ts: node.lamport, text: `N${id + 1} → (deferred) REPLY → N${d + 1}` });
        this.onReply(d, id);
      });
    }
  }

  snapshot() {
    return {
      auto: this.auto,
      speed: this.speed,
      holder: this.nodes.find((n) => n.status === "holding")?.id ?? null,
      nodes: this.nodes.map((n) => ({ ...n, deferred: [...n.deferred], repliesFrom: [...n.repliesFrom] })),
      events: [...this.events],
    };
  }
}

export function getRicartLab(): RicartAgrawala {
  return getGlobal("dslab.ricart", () => new RicartAgrawala());
}
