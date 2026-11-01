/**
 * DeadlockLab — a real resource manager.
 *
 * Two tasks (T1, T2) acquire two resources (R1, R2) in opposite order.
 * Every lock/unlock goes through real manager logic; after each operation a
 * wait-for graph is rebuilt and a DFS cycle detection runs — the same
 * algorithm an OS deadlock detector uses.
 */
import { getGlobal } from "./store";
import type { DlEdge, DlId, DlLogEntry, DlState, TaskStatus } from "./types";

type TaskId = "T1" | "T2";
type ResId = "R1" | "R2";

interface Step {
  op: "acquire" | "request" | "preempt" | "grant" | "complete";
  t: TaskId;
  r?: ResId;
  kind: DlLogEntry["kind"];
  msg: string;
}

const SCHEDULE: Step[] = [
  { op: "acquire", t: "T1", r: "R1", kind: "ok", msg: "T1 lock(R1) — granted, T1 now holds R1" },
  { op: "acquire", t: "T2", r: "R2", kind: "ok", msg: "T2 lock(R2) — granted, T2 now holds R2" },
  { op: "request", t: "T1", r: "R2", kind: "warn", msg: "T1 lock(R2) — held by T2, T1 blocks (holds R1 while waiting)" },
  { op: "request", t: "T2", r: "R1", kind: "err", msg: "T2 lock(R1) — held by T1, T2 blocks → circular wait formed" },
];

const RECOVERY: Step[] = [
  { op: "preempt", t: "T2", r: "R2", kind: "warn", msg: "Recovery: T2 chosen as victim — force-release R2 (preemption)" },
  { op: "grant", t: "T1", r: "R2", kind: "ok", msg: "R2 granted to blocked T1 — T1 unblocks, holds R1 + R2" },
  { op: "complete", t: "T1", kind: "ok", msg: "T1 finishes its critical work and releases R1, R2" },
  { op: "acquire", t: "T2", r: "R1", kind: "ok", msg: "T2 retries: lock(R1) — granted" },
  { op: "acquire", t: "T2", r: "R2", kind: "ok", msg: "T2 retries: lock(R2) — granted" },
  { op: "complete", t: "T2", kind: "ok", msg: "T2 completes and releases everything — system recovered" },
];

interface TaskState {
  holds: ResId[];
  waitingFor: ResId | null;
  status: TaskStatus;
}

class DeadlockLab {
  tasks: Record<TaskId, TaskState> = this.freshTasks();
  resources: Record<ResId, { holder: TaskId | null }> = {
    R1: { holder: null },
    R2: { holder: null },
  };
  stepIndex = 0;
  recoveryArmed = false;
  preempted = false;
  phase: DlState["phase"] = "idle";
  log: DlLogEntry[] = [
    {
      n: 1,
      kind: "info",
      text: "Schedule loaded: T1 → R1 then R2 · T2 → R2 then R1 (opposite order). Press STEP or AUTO to run.",
    },
  ];
  private logN = 1;
  private preemptFired = false;

  private freshTasks(): Record<TaskId, TaskState> {
    return {
      T1: { holds: [], waitingFor: null, status: "idle" },
      T2: { holds: [], waitingFor: null, status: "idle" },
    };
  }

  reset(): DlState {
    this.tasks = this.freshTasks();
    this.resources = { R1: { holder: null }, R2: { holder: null } };
    this.stepIndex = 0;
    this.recoveryArmed = false;
    this.preempted = false;
    this.preemptFired = false;
    this.phase = "idle";
    this.logN = 1;
    this.log = [
      {
        n: 1,
        kind: "info",
        text: "Schedule loaded: T1 → R1 then R2 · T2 → R2 then R1 (opposite order). Press STEP or AUTO to run.",
      },
    ];
    return this.snapshot();
  }

  armRecovery(): DlState {
    if (this.phase === "deadlocked") {
      this.recoveryArmed = true;
      this.phase = "recovering";
      this.push("info", "Recovery armed: victim selection — T2 holds fewer requested resources. Step to execute preemption.");
    }
    return this.snapshot();
  }

  private push(kind: DlLogEntry["kind"], text: string) {
    this.log = [...this.log, { n: ++this.logN, kind, text }].slice(-120);
  }

  /** Execute the next scheduled operation. Returns the full state. */
  step(): DlState {
    const inRecovery = this.phase === "recovering" || (this.recoveryArmed && this.phase === "deadlocked");
    const script = inRecovery ? RECOVERY : SCHEDULE;
    if (this.phase === "deadlocked" && !this.recoveryArmed) return this.snapshot();
    if (this.phase === "recovered") return this.snapshot();

    const idx = inRecovery ? this.stepIndex - SCHEDULE.length : this.stepIndex;
    const step = script[idx];
    if (!step) return this.snapshot();

    this.stepIndex++;
    if (this.phase === "idle") this.phase = "running";
    this.exec(step);

    const cycle = this.detectCycle();
    if (cycle && this.phase !== "recovering") {
      this.phase = "deadlocked";
      this.push("err", `DEADLOCK DETECTED — wait-for cycle: ${cycle.join(" → ")}`);
    } else if (this.phase === "recovering" && this.stepIndex >= SCHEDULE.length + RECOVERY.length) {
      this.phase = "recovered";
      this.push("ok", "Both tasks completed. Circular wait broken by preemption — no deadlock possible this run.");
    }
    return this.snapshot();
  }

  private exec(s: Step) {
    const t = this.tasks[s.t];
    switch (s.op) {
      case "acquire":
      case "grant": {
        if (!s.r) return;
        const r = this.resources[s.r];
        if (r.holder && r.holder !== s.t && s.op === "acquire") {
          // shouldn't happen in the scripted schedule for plain acquires
          t.waitingFor = s.r;
          t.status = "blocked";
        } else {
          r.holder = s.t;
          t.holds = [...t.holds.filter((x) => x !== s.r), s.r];
          if (t.waitingFor === s.r) t.waitingFor = null;
          t.status = "running";
        }
        break;
      }
      case "request": {
        if (!s.r) return;
        const r = this.resources[s.r];
        if (r.holder === null) {
          r.holder = s.t;
          t.holds = [...t.holds, s.r];
          t.status = "running";
        } else if (r.holder !== s.t) {
          t.waitingFor = s.r;
          t.status = "blocked";
        }
        break;
      }
      case "preempt": {
        if (!s.r) return;
        this.resources[s.r].holder = null;
        t.holds = t.holds.filter((x) => x !== s.r);
        t.waitingFor = null;
        t.status = "preempted";
        this.preempted = true;
        this.preemptFired = true;
        break;
      }
      case "complete": {
        for (const r of t.holds) this.resources[r].holder = null;
        t.holds = [];
        t.waitingFor = null;
        t.status = "done";
        break;
      }
    }
    this.push(s.kind, s.msg);
  }

  /** DFS cycle detection on the wait-for graph (task → task). */
  private detectCycle(): DlId[] | null {
    const edges = new Map<TaskId, TaskId>();
    for (const tid of ["T1", "T2"] as TaskId[]) {
      const w = this.tasks[tid].waitingFor;
      if (w) {
        const holder = this.resources[w].holder;
        if (holder && holder !== tid) edges.set(tid, holder);
      }
    }
    for (const start of ["T1", "T2"] as TaskId[]) {
      const seen = new Set<TaskId>();
      let cur: TaskId | undefined = start;
      const path: TaskId[] = [];
      while (cur) {
        if (cur === start && path.length > 0) {
          // expand task cycle into alternating task/resource nodes
          const expanded: DlId[] = [];
          const cyc = path.slice(path.indexOf(start));
          for (let i = 0; i < cyc.length; i++) {
            const a = cyc[i];
            const b = cyc[(i + 1) % cyc.length];
            expanded.push(a);
            const res = this.tasks[a].waitingFor;
            if (res && this.resources[res].holder === b) expanded.push(res);
          }
          expanded.push(cyc[0]);
          return expanded;
        }
        if (seen.has(cur)) break;
        seen.add(cur);
        path.push(cur);
        cur = edges.get(cur);
      }
      void edges;
    }
    return null;
  }

  snapshot(): DlState {
    const edges: DlEdge[] = [];
    for (const rid of ["R1", "R2"] as ResId[]) {
      const holder = this.resources[rid].holder;
      if (holder) edges.push({ from: rid, to: holder, kind: "assign" });
    }
    for (const tid of ["T1", "T2"] as TaskId[]) {
      const w = this.tasks[tid].waitingFor;
      if (w) edges.push({ from: tid, to: w, kind: "request" });
    }
    const cycle = this.detectCycle();
    const anyAllocated = edges.some((e) => e.kind === "assign");
    const holdAndWait = (["T1", "T2"] as TaskId[]).some(
      (t) => this.tasks[t].holds.length > 0 && this.tasks[t].waitingFor !== null
    );
    return {
      phase: this.phase,
      stepIndex: this.stepIndex,
      totalSteps: SCHEDULE.length + RECOVERY.length,
      recoveryArmed: this.recoveryArmed,
      tasks: {
        T1: {
          holds: [...this.tasks.T1.holds],
          waitingFor: this.tasks.T1.waitingFor,
          status: this.tasks.T1.status,
        },
        T2: {
          holds: [...this.tasks.T2.holds],
          waitingFor: this.tasks.T2.waitingFor,
          status: this.tasks.T2.status,
        },
      },
      resources: {
        R1: { holder: this.resources.R1.holder },
        R2: { holder: this.resources.R2.holder },
      },
      edges,
      cycle: this.phase === "deadlocked" ? cycle : cycle && !this.recoveryArmed ? cycle : null,
      coffman: {
        mutualExclusion: anyAllocated,
        holdAndWait,
        noPreemption: !this.preempted,
        circularWait: cycle !== null && !this.recoveryArmed,
      },
      log: this.log,
    };
  }
}

export function getDeadlockLab(): DeadlockLab {
  return getGlobal("dslab.deadlock", () => new DeadlockLab());
}
