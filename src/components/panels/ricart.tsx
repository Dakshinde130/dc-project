"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DoorOpen, KeyRound, RotateCcw, Timer, Vote } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, Toggle, type LogLine } from "@/components/ui";

type RAStatus = "idle" | "requesting" | "holding";

interface RANode {
  id: number;
  lamport: number;
  status: RAStatus;
  wantTs: number | null;
  deferred: number[];
  repliesFrom: number[];
  entries: number;
  holdUntilMs: number | null;
}

interface RAEvent {
  n: number;
  atMs: number;
  kind: "request" | "reply" | "defer" | "enter" | "exit";
  from: number;
  to: number | null;
  ts: number;
  text: string;
}

interface RAState {
  auto: boolean;
  speed: "slow" | "normal" | "fast";
  holder: number | null;
  nodes: RANode[];
  events: RAEvent[];
}

const POS = [
  { x: 260, y: 66 },
  { x: 436, y: 300 },
  { x: 84, y: 300 },
];
const CS = { x: 260, y: 210 };

interface Flight {
  id: number;
  from: number;
  to: number;
  kind: "request" | "reply" | "defer";
}

export default function RicartPanel() {
  const [state, setState] = useState<RAState | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const lastEventN = useRef(0);
  const flightId = useRef(0);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/ricart", { cache: "no-store" });
      const j = (await r.json()) as RAState;
      setState(j);
      const freshEvents = j.events.filter((e) => e.n > lastEventN.current);
      if (freshEvents.length > 0) {
        lastEventN.current = freshEvents[freshEvents.length - 1].n;
        const newFlights: Flight[] = [];
        const newLines: LogLine[] = [];
        for (const e of freshEvents) {
          if (e.from < 0) {
            newLines.push({ kind: "dim", text: e.text });
            continue;
          }
          if (e.kind === "request" && e.to === null) {
            for (const o of [0, 1, 2].filter((x) => x !== e.from)) {
              newFlights.push({ id: ++flightId.current, from: e.from, to: o, kind: "request" });
            }
          } else if ((e.kind === "reply" || e.kind === "defer") && e.to !== null) {
            newFlights.push({ id: ++flightId.current, from: e.from, to: e.to, kind: e.kind });
          }
          newLines.push({
            kind: e.kind === "defer" ? "warn" : e.kind === "enter" ? "ok" : e.kind === "exit" ? "ok" : "dim",
            text: e.text,
          });
        }
        if (newFlights.length > 0) {
          newFlights.forEach((f) => {
            window.setTimeout(() => setFlights((fl) => fl.filter((x) => x.id !== f.id)), 1150);
          });
          setFlights((fl) => [...fl, ...newFlights].slice(-24));
        }
        setLog((l) => [...l, ...newLines].slice(-110));
      }
    } catch {
      /* booting */
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 380);
    return () => clearInterval(t);
  }, [poll]);

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/ricart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setState(await r.json());
  };

  const totalEntries = useMemo(() => state?.nodes.reduce((s, n) => s + n.entries, 0) ?? 0, [state]);
  const totalDeferred = useMemo(() => state?.nodes.reduce((s, n) => s + n.deferred.length, 0) ?? 0, [state]);

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="cs holder" value={state?.holder != null ? `N${state.holder + 1}` : "free"} tone={state?.holder != null ? "acc" : undefined} sub="no lock server exists" />
        <Stat label="cs entries" value={totalEntries} sub="fairness watch" />
        <Stat label="deferred replies" value={totalDeferred} tone={totalDeferred > 0 ? "warn" : undefined} sub="queued right now" />
        <Stat label="lamport max" value={state ? Math.max(...state.nodes.map((n) => n.lamport)) : 0} sub="logical, not wall time" />
        <Stat label="contention" value={state?.auto ? "auto" : "manual"} sub={state ? state.speed : ""} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[300px_1fr_330px] gap-5">
        {/* controls */}
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Contention console</SectionLabel>
            <div className="mono text-[9.5px] tracking-[0.18em] uppercase" style={{ color: "var(--faint)" }}>
              make a node want the section
            </div>
            <div className="flex gap-2">
              {(state?.nodes ?? []).map((n) => (
                <button key={n.id} className="btn btn-acc flex-1 justify-center" disabled={n.status !== "idle"} onClick={() => post({ action: "request", node: n.id })}>
                  <KeyRound size={11} /> N{n.id + 1}
                </button>
              ))}
            </div>
            <Toggle on={state?.auto ?? false} onChange={(v) => post({ action: "auto", on: v })} label="AUTO CONTENTION" hint="nodes randomly crave the CS" />
            <div className="seg self-start">
              {(["slow", "normal", "fast"] as const).map((s) => (
                <button key={s} className={state?.speed === s ? "on" : ""} onClick={() => post({ action: "speed", speed: s })}>
                  {s}
                </button>
              ))}
            </div>
            <button
              className="btn self-start"
              onClick={() => {
                lastEventN.current = 0;
                setLog([]);
                post({ action: "reset" });
              }}
            >
              <RotateCcw size={12} /> reset protocol
            </button>
          </div>

          <div className="field-note">
            <b>Ricart–Agrawala (1981):</b> to enter, a node must collect a REPLY from <b>every</b> peer. If you&apos;re holding — or
            requested earlier (Lamport ts, ties by id) — you <b>defer</b>. 2(N−1) messages per entry, zero coordinators. Fairness falls
            out of the timestamps: watch entries stay near-equal.
          </div>
        </div>

        {/* arena */}
        <div className="card card-corners p-4 min-w-0">
          <SectionLabel
            right={
              <span className="flex items-center gap-3 mono text-[9px]" style={{ color: "var(--faint)" }}>
                <span className="flex items-center gap-1.5"><Vote size={10} /> request</span>
                <span className="flex items-center gap-1.5"><DoorOpen size={10} /> reply / defer</span>
              </span>
            }
          >
            Message arena · every line is a real async send
          </SectionLabel>
          <div className="overflow-x-auto">
            <div style={{ minWidth: 480, maxWidth: 640 }} className="mx-auto">
              <svg viewBox="0 0 520 380" className="w-full" style={{ display: "block" }}>
                <defs>
                  <filter id="ra-glow" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur stdDeviation="2.4" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* static mesh */}
                {[
                  [0, 1],
                  [1, 2],
                  [2, 0],
                ].map(([a, b]) => (
                  <line key={`${a}${b}`} x1={POS[a].x} y1={POS[a].y} x2={POS[b].x} y2={POS[b].y} stroke="rgba(255,255,255,.09)" strokeWidth="1" strokeDasharray="2 6" />
                ))}

                {/* message flights */}
                {flights.map((f) => {
                  const a = POS[f.from];
                  const b = POS[f.to];
                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2;
                  const cxs = mx + (CS.x - mx) * 0.22;
                  const cys = my + (CS.y - my) * 0.22;
                  const d = `M ${a.x} ${a.y} Q ${cxs} ${cys} ${b.x} ${b.y}`;
                  const stroke = f.kind === "request" ? "rgba(255,255,255,.9)" : f.kind === "defer" ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.65)";
                  return (
                    <g key={f.id}>
                      <path d={d} fill="none" stroke={stroke} strokeWidth={f.kind === "request" ? 1.6 : 1.2} strokeDasharray={f.kind === "defer" ? "2 5" : "none"} opacity="0.35" />
                      <circle r={f.kind === "request" ? 4.5 : 3.4} fill="#fff" filter="url(#ra-glow)">
                        <animateMotion dur="1s" path={d} fill="freeze" />
                        <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur="1.15s" fill="freeze" />
                      </circle>
                    </g>
                  );
                })}

                {/* critical section chamber */}
                <g>
                  <rect
                    x={CS.x - 56}
                    y={CS.y - 34}
                    width="112"
                    height="68"
                    rx="12"
                    fill={state?.holder != null ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.02)"}
                    stroke={state?.holder != null ? "#ffffff" : "rgba(255,255,255,.18)"}
                    strokeWidth="1.4"
                    style={{ transition: "all .3s", filter: state?.holder != null ? "drop-shadow(0 0 14px rgba(255,255,255,.35))" : undefined }}
                  />
                  <text x={CS.x} y={CS.y - 14} textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fill="#5d646b" letterSpacing="2">
                    CRITICAL SECTION
                  </text>
                  <text x={CS.x} y={CS.y + 8} textAnchor="middle" fontSize="17" fontFamily="var(--font-mono)" fontWeight="700" fill={state?.holder != null ? "#fff" : "#5d646b"}>
                    {state?.holder != null ? `N${state.holder + 1}` : "FREE"}
                  </text>
                  <text x={CS.x} y={CS.y + 24} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="#5d646b">
                    shared resource
                  </text>
                </g>

                {/* nodes */}
                {(state?.nodes ?? []).map((n) => {
                  const p = POS[n.id];
                  const stroke = n.status === "holding" ? "#ffffff" : n.status === "requesting" ? "#c9ced2" : "#4a5058";
                  return (
                    <g key={n.id}>
                      {n.status === "requesting" && (
                        <circle cx={p.x} cy={p.y} r="42" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1" strokeDasharray="3 6" style={{ animation: "dashmove 1.6s linear infinite" }} />
                      )}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="34"
                        fill={n.status === "holding" ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.035)"}
                        stroke={stroke}
                        strokeWidth={n.status === "holding" ? 2.4 : 1.5}
                        style={{ transition: "all .3s", filter: n.status === "holding" ? "drop-shadow(0 0 16px rgba(255,255,255,.5))" : undefined }}
                      />
                      <text x={p.x} y={p.y + 2} textAnchor="middle" fontSize="13" fontFamily="var(--font-mono)" fontWeight="700" fill={stroke}>
                        N{n.id + 1}
                      </text>
                      <text x={p.x} y={p.y + 16} textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="#9aa0a6">
                        λ{n.lamport}
                      </text>
                      <text x={p.x} y={n.id === 0 ? p.y + 58 : p.y + 54} textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill={stroke} letterSpacing="1.5">
                        {n.status.toUpperCase()}{n.wantTs ? ` ts=${n.wantTs}` : ""}
                      </text>
                      {/* deferred chips */}
                      {n.deferred.length > 0 && (
                        <g transform={`translate(${p.x - 26}, ${n.id === 0 ? p.y + 64 : p.y + 60})`}>
                          <rect width="52" height="15" rx="7.5" fill="rgba(0,0,0,.5)" stroke="rgba(255,255,255,.35)" strokeDasharray="2 3" />
                          <text x="26" y="11" textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fill="#d5d8db">
                            defer {n.deferred.map((d) => `N${d + 1}`).join(",")}
                          </text>
                        </g>
                      )}
                      <text x={p.x} y={n.id === 0 ? p.y - 44 : p.y - 40} textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="#5d646b">
                        entries {n.entries}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        {/* log */}
        <div className="flex flex-col gap-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card p-4 flex-1 flex flex-col">
            <SectionLabel right={<Badge tone="acc">{state?.events.length ?? 0} msgs</Badge>}>Protocol log</SectionLabel>
            <Terminal lines={log} height={440} />
          </div>
          <div className="card p-4">
            <SectionLabel>
              <span className="flex items-center gap-1.5"><Timer size={10} /> timing</span>
            </SectionLabel>
            <p className="mono text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
              request → 2(N−1) REPLYs → enter. exit → deferred REPLYs flush. λ is each node&apos;s Lamport clock — it jumps when messages
              arrive (max+1). no wall clocks involved; ordering comes from <b style={{ color: "#fff" }}>happened-before</b>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
