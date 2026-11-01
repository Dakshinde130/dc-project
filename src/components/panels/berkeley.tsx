"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmClockCheck, Gauge, RotateCcw, TimerReset } from "lucide-react";
import { Badge, NeonSlider, SectionLabel, Stat, Terminal, Toggle, type LogLine } from "@/components/ui";

interface NodeClock {
  id: string;
  pid: number | null;
  clock: number;
  driftPpm: number;
  offsetMs: number;
  adjustMs: number;
  offsetVsCoordinator: number;
  ok: boolean;
}

interface BerkeleyRound {
  round: number;
  ts: number;
  avgClock: number;
  spreadBeforeMs: number;
  spreadAfterMs: number | null;
  adjustments: Record<string, number>;
}

interface BerkeleyState {
  coordinator: number;
  nodes: NodeClock[];
  round: number;
  lastRound: BerkeleyRound | null;
  history: { round: number; ts: number; spreadMs: number }[];
  auto: boolean;
  autoMs: number;
}

function fmtClock(ms: number) {
  const d = new Date(ms);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function Dial({ node }: { node: NodeClock }) {
  const deg = Math.max(-160, Math.min(160, (node.offsetVsCoordinator / 600) * 150));
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: 128, height: 128 }}>
        {/* bezel */}
        <div className="absolute inset-0 rounded-full" style={{
          background: "radial-gradient(circle at 34% 26%, #3a3e42, #1d1f22 60%, #131517 100%)",
          border: "1px solid rgba(0,0,0,.7)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.14), inset 0 -3px 8px rgba(0,0,0,.55), 0 10px 22px -12px rgba(0,0,0,.9)",
        }} />
        <svg viewBox="0 0 128 128" className="absolute inset-0">
          {ticks.map((a) => (
            <line
              key={a}
              x1="64"
              y1="12"
              x2="64"
              y2={a % 90 === 0 ? "20" : "16"}
              stroke="rgba(255,255,255,.3)"
              strokeWidth={a % 90 === 0 ? 2 : 1}
              transform={`rotate(${a} 64 64)`}
            />
          ))}
          {/* zero marker */}
          <circle cx="64" cy="12" r="2" fill="#fff" />
          {/* hand */}
          <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: "64px 64px", transition: "transform .8s cubic-bezier(.3,1.2,.3,1)" }}>
            <line x1="64" y1="64" x2="64" y2="20" stroke="#fff" strokeWidth="2.4" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,.7))" }} />
            <circle cx="64" cy="64" r="4.5" fill="#fff" />
          </g>
        </svg>
        {/* glass */}
        <div className="absolute inset-[3px] rounded-full pointer-events-none" style={{
          background: "radial-gradient(circle at 32% 22%, rgba(255,255,255,.16), transparent 42%)",
        }} />
      </div>
      <span className="mono text-[11px] font-bold">{node.id}</span>
      <span className="mono tnum text-[10px]" style={{ color: Math.abs(node.offsetVsCoordinator) < 25 ? "#fff" : "var(--dim)" }}>
        {node.offsetVsCoordinator >= 0 ? "+" : ""}{node.offsetVsCoordinator.toFixed(0)}ms vs coord
      </span>
      <span className="mono text-[9px]" style={{ color: "var(--faint)" }}>
        drift {node.driftPpm >= 0 ? "+" : ""}{node.driftPpm}ppm · adj {node.adjustMs >= 0 ? "+" : ""}{node.adjustMs.toFixed(0)}ms
      </span>
    </div>
  );
}

export default function BerkeleyPanel() {
  const [state, setState] = useState<BerkeleyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const lastLoggedRound = useRef(0);
  const driftTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/berkeley", { cache: "no-store" });
      const j = (await r.json()) as BerkeleyState;
      setState(j);
      const lr = j.lastRound;
      if (lr && lr.round !== lastLoggedRound.current) {
        lastLoggedRound.current = lr.round;
        setLog((l) =>
          [
            ...l,
            { kind: "info" as const, text: `round ${lr.round}: polled 3 clocks, avg ${fmtClock(lr.avgClock)}, spread ${lr.spreadBeforeMs}ms` },
            ...Object.entries(lr.adjustments).map(([id, d]) => ({
              kind: "dim" as const,
              text: `adjust ${id}: ${d >= 0 ? "+" : ""}${d}ms`,
            })),
            {
              kind: "ok" as const,
              text: `round ${lr.round} converged: spread ${lr.spreadBeforeMs}ms → ${lr.spreadAfterMs ?? "?"}ms`,
            },
          ].slice(-90)
        );
      }
    } catch {
      /* booting */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 800);
    return () => clearInterval(t);
  }, [refresh]);

  const post = async (body: Record<string, unknown>) => {
    await fetch("/api/berkeley", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await refresh();
  };

  const syncNow = async () => {
    setBusy(true);
    await post({ action: "sync" });
    setBusy(false);
  };

  const setDrift = (id: string, ppm: number) => {
    setState((s) => (s ? { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, driftPpm: ppm } : n)) } : s));
    clearTimeout(driftTimers.current[id]);
    driftTimers.current[id] = setTimeout(() => {
      void fetch("/api/berkeley", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "drift", id, ppm }) });
    }, 180);
  };

  const spread = state?.nodes.length ? Math.max(...state.nodes.filter((n) => n.ok).map((n) => n.offsetVsCoordinator)) - Math.min(...state.nodes.filter((n) => n.ok).map((n) => n.offsetVsCoordinator)) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="coordinator" value={<span className="text-[13px] tnum">{state ? fmtClock(state.coordinator) : "…"}</span>} sub="control plane clock" />
        <Stat label="live spread" value={spread != null ? `${spread.toFixed(0)}ms` : "—"} tone={spread != null && spread < 30 ? "ok" : spread != null && spread > 200 ? "warn" : undefined} sub="max − min offset" />
        <Stat label="sync rounds" value={state?.round ?? 0} sub={state?.auto ? `auto every ${(state.autoMs ?? 4000) / 1000}s` : "manual"} />
        <Stat label="last convergence" value={state?.lastRound ? `${state.lastRound.spreadBeforeMs} → ${state.lastRound.spreadAfterMs ?? "?"}ms` : "—"} sub="spread before → after" />
        <Stat label="avg clock" value={state?.lastRound ? <span className="text-[13px] tnum">{fmtClock(state.lastRound.avgClock)}</span> : "—"} sub="fault-tolerant mean" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[300px_1fr_330px] gap-5">
        {/* controls */}
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Coordinator</SectionLabel>
            <button className="btn btn-acc justify-center" disabled={busy} onClick={syncNow}>
              <TimerReset size={12} /> run sync round
            </button>
            <Toggle on={state?.auto ?? false} onChange={(v) => post({ action: "auto", on: v })} label="AUTO SYNC" hint={`coordinator polls every ${(state?.autoMs ?? 4000) / 1000}s`} />
            <div className="seg self-start">
              {[3000, 4000, 8000].map((ms) => (
                <button key={ms} className={state?.autoMs === ms ? "on" : ""} onClick={() => post({ action: "auto", on: state?.auto ?? false, ms })}>
                  {ms / 1000}s
                </button>
              ))}
            </div>
            <div className="h-px" style={{ background: "var(--line-soft)" }} />
            <div className="mono text-[9.5px] tracking-[0.18em] uppercase" style={{ color: "var(--faint)" }}>
              <span className="flex items-center gap-1.5"><Gauge size={10} /> sabotage the crystals</span>
            </div>
            {state?.nodes.map((n) => (
              <div key={n.id}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="mono text-[10px]" style={{ color: "var(--dim)" }}>{n.id} drift</span>
                  <span className="mono tnum text-[10px]" style={{ color: "var(--dim)" }}>{n.driftPpm >= 0 ? "+" : ""}{n.driftPpm}ppm</span>
                </div>
                <NeonSlider value={n.driftPpm} min={-300} max={300} onChange={(v) => setDrift(n.id, v)} />
              </div>
            ))}
            <button className="btn self-start" onClick={() => { setLog([]); lastLoggedRound.current = 0; post({ action: "reset" }); }}>
              <RotateCcw size={12} /> reset adjustments
            </button>
          </div>
          <div className="field-note">
            <b>Berkeley (1989):</b> no node is “right”. The coordinator polls everyone, averages (including itself), and tells each clock
            how far to lean — <b>adjustments, not truth</b>. Crank a drift slider to 300ppm and watch auto-sync fight it forever.
          </div>
        </div>

        {/* dials */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="card card-corners p-5">
            <SectionLabel right={<Badge tone="acc">{state?.nodes.filter((n) => n.ok).length ?? 0}/3 reachable</Badge>}>Process clocks · polling live</SectionLabel>
            <div className="flex flex-wrap items-start justify-center gap-6 md:gap-10 py-2">
              {(state?.nodes ?? []).map((n) => (
                <Dial key={n.id} node={n} />
              ))}
              {(state?.nodes ?? []).length === 0 && <span className="mono text-[11px] acc-text" style={{ animation: "ledblink 1.1s infinite" }}>booting worker clocks…</span>}
            </div>
          </div>

          <div className="card p-4">
            <SectionLabel>Spread before each round</SectionLabel>
            <div className="well rounded-lg p-3">
              <div className="flex items-end gap-[3px] h-[90px]">
                {(state?.history ?? []).map((h, i) => {
                  const arr = state?.history ?? [];
                  const max = Math.max(50, ...arr.map((x) => x.spreadMs));
                  return (
                    <div
                      key={h.round}
                      title={`round ${h.round}: ${h.spreadMs}ms spread`}
                      className="flex-1 rounded-[2px]"
                      style={{
                        height: `${Math.max(8, (h.spreadMs / max) * 100)}%`,
                        background: "linear-gradient(180deg,#fff,#9ba0a5)",
                        opacity: 0.4 + (0.6 * i) / Math.max(1, arr.length),
                        transition: "height .3s ease",
                      }}
                    />
                  );
                })}
                {(state?.history ?? []).length === 0 && <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>each bar = how far apart the clocks were when a round began</span>}
              </div>
            </div>
          </div>
        </div>

        {/* log */}
        <div className="flex flex-col gap-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card p-4 flex-1 flex flex-col">
            <SectionLabel right={<AlarmClockCheck size={11} style={{ color: "var(--faint)" }} />}>Coordinator log</SectionLabel>
            <Terminal lines={log} height={440} />
          </div>
          <div className="card p-4">
            <SectionLabel>Reading the dials</SectionLabel>
            <p className="mono text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
              white tick at 12 o&apos;clock = perfect agreement with the coordinator. hand right = this process believes it&apos;s later than
              it is. after a sync round all hands snap near zero — then drift pulls them apart again, because that&apos;s what crystals do.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
