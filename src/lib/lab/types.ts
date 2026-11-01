/**
 * Shared types for the Distributed Systems Teaching Lab.
 * Imported by server engines and by client components (type-only).
 */

/* ---------------------------------- LB ---------------------------------- */

export type LbAlgorithm =
  | "round-robin"
  | "least-connections"
  | "ip-hash"
  | "random";

export interface BackendStatus {
  id: string;
  port: number;
  pid: number | null;
  alive: boolean;
  delayMs: number;
  /** in-flight requests as counted by the load balancer */
  active: number;
  /** requests routed to this backend by the LB */
  routed: number;
  completed: number;
  failed: number;
  avgLatencyMs: number | null;
  lastLatencyMs: number | null;
  /** served count reported by the backend process itself */
  reportedServed: number;
}

export interface LbStatus {
  ok: boolean;
  algorithm: LbAlgorithm;
  slowBackendId: string | null;
  slowDelayMs: number;
  startedAt: number;
  totalRequests: number;
  inFlight: number;
  backends: BackendStatus[];
  error?: string;
}

export interface LbDecision {
  seq: number;
  ts: number;
  clientIp: string;
  algorithm: LbAlgorithm;
  backendId: string | null;
  backendPort: number | null;
  backendPid: number | null;
  backendSeq: number | null;
  latencyMs: number | null;
  ok: boolean;
  reason: string;
  activeAtPick: Record<string, number>;
}

/* -------------------------------- Deadlock ------------------------------- */

export type DlPhase = "idle" | "running" | "deadlocked" | "recovering" | "recovered";
export type TaskStatus = "idle" | "running" | "blocked" | "preempted" | "done";
export type DlId = "T1" | "T2" | "R1" | "R2";

export interface DlEdge {
  from: DlId;
  to: DlId;
  kind: "assign" | "request";
}

export interface DlLogEntry {
  n: number;
  kind: "info" | "ok" | "warn" | "err";
  text: string;
}

export interface DlState {
  phase: DlPhase;
  stepIndex: number;
  totalSteps: number;
  recoveryArmed: boolean;
  tasks: Record<"T1" | "T2", { holds: string[]; waitingFor: string | null; status: TaskStatus }>;
  resources: Record<"R1" | "R2", { holder: "T1" | "T2" | null }>;
  edges: DlEdge[];
  /** wait-for cycle as alternating task/resource ids, e.g. [T1,R2,T2,R1,T1] */
  cycle: DlId[] | null;
  coffman: {
    mutualExclusion: boolean;
    holdAndWait: boolean;
    noPreemption: boolean;
    circularWait: boolean;
  };
  log: DlLogEntry[];
}

/* --------------------------------- Banker -------------------------------- */

export interface BankState {
  total: number[];
  allocation: number[][];
  max: number[][];
}

export interface BankTraceRow {
  step: number;
  pid: number;
  work: number[];
  need: number[];
  ok: boolean;
  note: string;
}

export interface BankCheckResult {
  ok: boolean;
  available: number[];
  need: number[][];
  safe: boolean;
  sequence: number[];
  trace: BankTraceRow[];
  error?: string;
}

export interface BankRequestResult {
  granted: boolean;
  reason: string;
  state?: BankState;
  safety?: BankCheckResult;
}

/* --------------------------------- Mutex --------------------------------- */

export type MutexMode = "mutex" | "race";

export interface MutexEvent {
  i: number;
  atMs: number;
  kind: "request" | "acquire" | "leave" | "release" | "done";
  tid: number;
  counter?: number;
  holdMs?: number;
}

export interface MutexResult {
  finalCounter: number;
  expected: number;
  lost: number;
  elapsedMs: number;
  mode: MutexMode;
}
