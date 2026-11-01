"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check,Hand, Lock, Pause, Play, RotateCcw, ShieldOff, StepForward, X } from "lucide-react";
import type { DlId, DlState } from "@/lib/lab/types";
import { Badge, SectionLabel, Stat, Terminal, type LogLine } from "@/components/ui";

/* ------------------------------- geometry -------------------------------- */

const POS: Record<DlId, { x: number; y: number }> = {
  T1: { x: 260, y: 86 },
  R2: { x: 414, y: 224 },
  T2: { x: 260, y: 362 },
  R1: { x: 106, y: 224 },
};

function radius(id: DlId) {
  return id.startsWith("T") ? 32 : 30;
}

function edgePath(from: DlId, to: DlId): { d: string; ax: number; ay: number; ang: number } {
  const a = POS[from];
  const b = POS[to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ra = radius(from) + 4;
  const rb = radius(to) + 9;
  const sx = a.x + ux * ra;
  const sy = a.y + uy * ra;
  const ex = b.x - ux * rb;
  const ey = b.y - uy * rb;
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const off = 17;
  const cx = mx - uy * off;
  const cy = my + ux * off;
  const ang = (Math.atan2(ey - cy, ex - cx) * 180) / Math.PI;
  return { d: `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`, ax: ex, ay: ey, ang };
}

function Graph({ state }: { state: DlState }) {
  const inCycle = (from: DlId, to: DlId) => {
    if (!state.cycle) return false;
    for (let i = 0; i < state.cycle.length - 1; i++) {
      if (state.cycle[i] === from && state.cycle[i + 1] === to) return true;
    }
    return false;
  };

  const taskColor = (id: "T1" | "T2") => {
    const s = state.tasks[id].status;
    if (s === "blocked") return "#ffffff";
    if (s === "done") return "#7d848a";
    if (s === "preempted") return "#c4c9cd";
    if (s === "running") return "#f3f4f5";
    return "#55616d";
  };

  return (
    <svg viewBox="0 0 520 448" className="w-full" style={{ display: "block" }}>
      <defs>
        <filter id="dl-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* edges */}
      {state.edges.map((e, i) => {
        const { d, ax, ay, ang } = edgePath(e.from, e.to);
        const cyc = inCycle(e.from, e.to);
        const cls = cyc ? "edge-cycle" : e.kind === "assign" ? "edge-assign" : "edge-request";
        return (
          <g key={`${e.from}-${e.to}-${e.kind}-${i}`}>
            <path d={d} className={`edge-line ${cls}`} markerEnd={undefined} filter={cyc ? "url(#dl-glow)" : undefined} />
            <g transform={`translate(${ax},${ay}) rotate(${ang})`}>
              <polygon
                points="0,-4.6 10,0 0,4.6"
                fill={cyc ? "#ffffff" : e.kind === "assign" ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.5)"}
              />
            </g>
            {/* edge kind label at midpoint-ish */}
            <EdgeLabel from={e.from} to={e.to} kind={e.kind} cyc={cyc} />
          </g>
        );
      })}

      {/* resource nodes (squares) */}
      {(["R1", "R2"] as const).map((rid) => {
        const p = POS[rid];
        const holder = state.resources[rid].holder;
        const contested = state.edges.some((e) => e.kind === "request" && e.to === rid);
        return (
          <g key={rid}>
            <rect
              x={p.x - 26}
              y={p.y - 26}
              width="52"
              height="52"
              rx="9"
              fill={holder ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.03)"}
              stroke={contested ? "#ffffff" : holder ? "rgba(255,255,255,.7)" : "#3d434a"}
              strokeWidth={contested ? 2 : 1.5}
              style={{ transition: "all .3s", filter: contested ? "drop-shadow(0 0 10px rgba(255,255,255,.6))" : undefined }}
            />
            <text x={p.x} y={p.y + 1} textAnchor="middle" fontSize="13" fontFamily="var(--font-mono)" fontWeight="700" fill="#e8eef4">
              {rid}
            </text>
            <text x={p.x} y={p.y + 15} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="#55616d">
              MUTEX
            </text>
            <text x={p.x} y={p.y + 42} textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)" fill={holder ? "#eceff1" : "#55616d"}>
              {holder ? `held by ${holder}` : "free"}
            </text>
          </g>
        );
      })}

      {/* task nodes (circles) */}
      {(["T1", "T2"] as const).map((tid) => {
        const p = POS[tid];
        const c = taskColor(tid);
        const t = state.tasks[tid];
        return (
          <g key={tid}>
            {t.status === "blocked" && (
              <circle cx={p.x} cy={p.y} r="37" fill="none" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 5" style={{ animation: "dashmove 1.4s linear infinite" }} />
            )}
            <circle cx={p.x} cy={p.y} r="30" fill="rgba(255,255,255,.035)" stroke={c} strokeWidth="1.8" style={{ transition: "stroke .3s", filter: t.status === "running" ? "drop-shadow(0 0 10px rgba(255,255,255,.35))" : undefined }} />
            <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="13" fontFamily="var(--font-mono)" fontWeight="700" fill={c}>
              {tid}
            </text>
            <text
              x={p.x}
              y={tid === "T1" ? p.y - 44 : p.y + 56}
              textAnchor="middle"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
              fill={c}
              style={{ textTransform: "uppercase", letterSpacing: ".12em" }}
            >
              {t.status}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EdgeLabel({ from, to, kind, cyc }: { from: DlId; to: DlId; kind: "assign" | "request"; cyc: boolean }) {
  const a = POS[from];
  const b = POS[to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const mx = (a.x + b.x) / 2 - uy * 17;
  const my = (a.y + b.y) / 2 + ux * 17;
  return (
    <text
      x={mx}
      y={my - 6}
      textAnchor="middle"
      fontSize="8.5"
      fontFamily="var(--font-mono)"
      fill={cyc ? "#ffffff" : kind === "assign" ? "rgba(255,255,255,.8)" : "rgba(255,255,255,.5)"}
    >
      {kind === "assign" ? "holds" : "waits"}
    </text>
  );
}

/* --------------------------------- panel --------------------------------- */

const COFFMAN = [
  { key: "mutualExclusion", name: "Mutual exclusion", desc: "R1/R2 are non-sharable locks" },
  { key: "holdAndWait", name: "Hold & wait", desc: "a task waits while keeping its lock" },
  { key: "noPreemption", name: "No preemption", desc: "locks cannot be force-taken… yet" },
  { key: "circularWait", name: "Circular wait", desc: "a cycle exists in the wait-for graph" },
] as const;

export default function DeadlockPanel() {
  const [state, setState] = useState<DlState | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);

  const call = useCallback(async (action: string) => {
    const r = await fetch("/api/deadlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = (await r.json()) as DlState;
    setState(j);
    return j;
  }, []);

  useEffect(() => {
    fetch("/api/deadlock", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DlState) => setState(j))
      .catch(() => undefined);
  }, []);

  /* autoplay */
  const autoRef = useRef(autoPlay);
  autoRef.current = autoPlay;
  useEffect(() => {
    if (!autoPlay) return;
    const t = setInterval(async () => {
      const s = await call("step");
      if (!autoRef.current) return;
      if (s.phase === "deadlocked" || s.phase === "recovered") setAutoPlay(false);
    }, 1100);
    return () => clearInterval(t);
  }, [autoPlay, call]);

  if (!state) {
    return (
      <div className="card h-64 flex items-center justify-center">
        <span className="mono text-[11px]" style={{ color: "var(--err)", animation: "ledpulse 1.2s infinite" }}>
          attaching to resource manager…
        </span>
      </div>
    );
  }

  const deadlocked = state.phase === "deadlocked";
  const recovered = state.phase === "recovered";
  const logLines: LogLine[] = state.log.map((l) => ({ kind: l.kind, text: l.text }));

  return (
    <div className="flex flex-col gap-5">
      {/* stat strip */}
      <div className="card px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
        <Stat
          label="system phase"
          value={<span className="text-[13px] uppercase tracking-wider">{state.phase}</span>}
          tone={deadlocked ? "err" : recovered ? "ok" : "acc"}
        />
        <Stat label="schedule progress" value={`${state.stepIndex} / ${state.totalSteps}`} sub="scripted lock ops" />
        <Stat label="wait-for edges" value={state.edges.length} sub={`${state.edges.filter((e) => e.kind === "request").length} pending requests`} />
        <div className="flex items-center justify-end">
          {deadlocked && <span className="stamp" style={{ color: "var(--err)" }}>DEADLOCK DETECTED</span>}
          {recovered && <span className="stamp" style={{ color: "var(--ok)" }}>RECOVERED</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[300px_1fr_330px] gap-5">
        {/* controls + coffman */}
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4">
            <SectionLabel>Scheduler</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-acc" disabled={deadlocked || recovered} onClick={() => call("step")}>
                <StepForward size={12} /> step
              </button>
              <button
                className="btn"
                disabled={deadlocked || recovered}
                onClick={() => setAutoPlay((v) => !v)}
              >
                {autoPlay ? <Pause size={12} /> : <Play size={12} />} {autoPlay ? "pause" : "auto"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setAutoPlay(false);
                  call("reset");
                }}
              >
                <RotateCcw size={12} /> reset
              </button>
            </div>
            <button
              className={`btn mt-2.5 w-full justify-center ${deadlocked ? "btn-danger" : ""}`}
              disabled={!deadlocked}
              onClick={async () => {
                await call("recover");
                setAutoPlay(true);
              }}
            >
              <ShieldOff size={12} />
              {state.recoveryArmed ? "recovery armed — stepping…" : "recover: preempt victim T2"}
            </button>
            <p className="mono mt-3 text-[9.5px] leading-relaxed" style={{ color: "var(--faint)" }}>
              two tasks · two mutex-locks · opposite acquisition order. advance the schedule and watch the wait-for graph.
            </p>
          </div>

          <div className="card p-4">
            <SectionLabel>Coffman conditions</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {COFFMAN.map((c) => {
                const holds = state.coffman[c.key];
                return (
                  <div key={c.key} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 w-4 h-4 rounded flex-none flex items-center justify-center border"
                      style={{
                        borderColor: holds ? (c.key === "circularWait" ? "rgba(255,255,255,.8)" : "rgba(255,255,255,.4)") : "var(--line)",
                        background: holds ? (c.key === "circularWait" ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.06)") : "transparent",
                        color: holds ? (c.key === "circularWait" ? "#ffffff" : "#d5d8db") : "var(--faint)",
                        transition: "all .3s",
                      }}
                    >
                      {holds ? <Check size={10} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}
                    </span>
                    <span className="flex flex-col">
                      <span className="mono text-[11px] font-semibold" style={{ color: holds ? "var(--ink)" : "var(--faint)" }}>
                        {c.name}
                      </span>
                      <span className="mono text-[9.5px]" style={{ color: "var(--faint)" }}>
                        {c.desc}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mono mt-3 text-[9.5px] leading-relaxed" style={{ color: "var(--faint)" }}>
              all four holding ⇒ deadlock can occur. recovery defeats <b style={{ color: "var(--warn)" }}>no preemption</b>.
            </p>
          </div>
        </div>

        {/* graph */}
        <div className="card card-corners p-4 min-w-0">
          <SectionLabel
            right={
              <span className="flex items-center gap-3 mono text-[9px]" style={{ color: "var(--faint)" }}>
                <span className="flex items-center gap-1.5"><Lock size={10} style={{ color: "#eceff1" }} /> holds</span>
                <span className="flex items-center gap-1.5"><Hand size={10} style={{ color: "#9aa0a6" }} /> waits-for</span>
              </span>
            }
          >
            Wait-for graph · live
          </SectionLabel>
          <div className="overflow-x-auto">
            <div style={{ minWidth: 440 }}>
              <Graph state={state} />
            </div>
          </div>
          {deadlocked && (
            <div className="field-note hatch mt-2" style={{ borderColor: "rgba(255,255,255,.75)" }}>
              <b>Cycle found by DFS:</b> <span className="mono" style={{ color: "#ffffff" }}>{state.cycle?.join(" → ")}</span>.
              Neither task can ever progress — T1 waits on R2 held by T2, T2 waits on R1 held by T1. No amount of scheduling fixes this; only intervention does.
            </div>
          )}
          {recovered && (
            <div className="field-note mt-2">
              <b>Recovery by preemption:</b> the manager force-released R2 from victim T2, let T1 drain and finish, then restarted T2 from scratch. Real systems do this — or kill the victim entirely (see: database deadlock victims).
            </div>
          )}
        </div>

        {/* log */}
        <div className="flex flex-col gap-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card p-4 flex-1 flex flex-col">
            <SectionLabel right={<Badge tone="acc">{state.log.length} events</Badge>}>Resource manager log</SectionLabel>
            <Terminal lines={logLines} height={420} />
          </div>
          <div className="card p-4">
            <SectionLabel>How detection works</SectionLabel>
            <p className="mono text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
              after every lock op, the manager rebuilds the wait-for graph: <span style={{ color: "var(--warn)" }}>T → R</span> for each pending request,{" "}
              <span style={{ color: "var(--ok)" }}>R → T</span> for each grant. collapsing through resources gives a task→task graph; DFS on it finds a cycle iff the system is deadlocked. that exact check just ran — which is how the cycle was flagged.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
