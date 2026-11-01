"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RotateCcw, Send, Turtle, Zap } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, Toggle, type LogLine } from "@/components/ui";

interface Decision {
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
interface RRState {
  cursor: number;
  seq: number;
  counts: Record<string, number>;
  history: Decision[];
  slowId: string | null;
  backends: { id: string; port: number; pid: number | null; alive: boolean; active: number; delayMs: number }[];
}

export default function RoundRobinPanel() {
  const [state, setState] = useState<RRState | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const seen = useRef(0);

  const refresh = useCallback(async () => {
    try { setState(await (await fetch("/api/roundrobin", { cache: "no-store" })).json()); } catch { /* boot */ }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 750); return () => clearInterval(t); }, [refresh]);

  const absorb = useCallback((ds: Decision[]) => {
    if (ds.length === 0) return;
    seen.current = Math.max(seen.current, ...ds.map((d) => d.seq));
    setLog((l) => [...l, ...ds.map((d) => ({
      kind: d.ok ? ("ok" as const) : ("err" as const),
      text: `cursor ${d.seq - 1} mod 3 = ${d.slot} → ${d.backendId} · pid ${d.pid} · op #${d.backendSeq ?? "—"} · ${d.latencyMs}ms`,
    }))].slice(-100));
  }, []);

  const send = useCallback(async (count = 1) => {
    setBusy(true);
    const r = await fetch("/api/roundrobin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(count === 1 ? { action: "request" } : { action: "burst", count }),
    });
    const d = await r.json();
    absorb(d.decisions ?? [d]);
    await refresh();
    setBusy(false);
  }, [absorb, refresh]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void send(1), 480);
    return () => clearInterval(t);
  }, [auto, send]);

  const slow = !!state?.slowId;
  const total = Object.values(state?.counts ?? {}).reduce((s, v) => s + v, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="routed" value={state?.seq ?? 0} sub="strict cursor sequence" />
        <Stat label="next slot" value={(state?.cursor ?? 0) % 3} tone="acc" sub={`cursor ${(state?.cursor ?? 0)} mod 3`} />
        <Stat label="distribution" value={state ? Object.values(state.counts).join(" / ") : "0 / 0 / 0"} sub="BE1 / BE2 / BE3" />
        <Stat label="active requests" value={state?.backends.reduce((s, b) => s + b.active, 0) ?? 0} />
        <Stat label="workers" value={`${state?.backends.filter((b) => b.alive).length ?? 0} / 3`} tone={state?.backends.every((b) => b.alive) ? "ok" : "warn"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_340px] gap-5">
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Traffic</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-acc" disabled={busy} onClick={() => send(1)}><Send size={12} /> request</button>
              <button className="btn" disabled={busy} onClick={() => send(12)}><Zap size={12} /> ×12</button>
              <button className="btn" disabled={busy} onClick={() => send(30)}><Zap size={12} /> ×30</button>
            </div>
            <Toggle on={auto} onChange={setAuto} label="AUTO TRAFFIC" hint="one request every 480ms" />
            <Toggle
              on={slow}
              onChange={async (v) => {
                await fetch("/api/roundrobin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "slow", slow: v }) });
                refresh();
              }}
              label={<span className="flex items-center gap-1.5"><Turtle size={11} /> SLOW BE-4102</span>}
              hint="+900ms — RR still sends every third"
            />
            <button className="btn self-start" onClick={async () => { setLog([]); seen.current = 0; await fetch("/api/roundrobin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) }); refresh(); }}><RotateCcw size={12} /> reset cursor</button>
          </div>
          <div className="field-note">
            <b>Round Robin is fair by count, not by work.</b> The invariant is mechanical: cursor mod N, increment, repeat. Enable slow
            BE-4102 and burst: it still receives exactly every third request while its latency balloons. Compare that with least-connections
            from a production load balancer.
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="card card-corners p-5">
            <SectionLabel right={<Badge tone="acc">cursor mod 3</Badge>}>Rotation ring · real process targets</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-3">
              {(state?.backends ?? []).map((b, i) => {
                const count = state?.counts[b.id] ?? 0;
                const share = total ? (count / total) * 100 : 0;
                const next = ((state?.cursor ?? 0) % 3) === i;
                return (
                  <div key={b.id} className="card p-4 flex flex-col gap-3" style={next ? { borderColor: "rgba(255,255,255,.6)", boxShadow: "0 0 22px -9px rgba(255,255,255,.6)" } : undefined}>
                    <div className="flex items-center gap-2"><span className={`led ${!b.alive ? "err" : b.delayMs ? "warn" : "on"}`} /><span className="mono text-[12px] font-bold">{b.id}</span>{next && <span className="chip chip-acc ml-auto">NEXT</span>}</div>
                    <div className="mono tnum text-[30px] font-bold">{count}</div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${share}%` }} /></div>
                    <div className="mono text-[9.5px]" style={{ color: "var(--faint)" }}>slot {i} · pid {b.pid ?? "—"} · :{b.port}<br />{b.delayMs ? `degraded +${b.delayMs}ms` : "normal latency"}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-2 mono text-[10px]" style={{ color: "var(--dim)" }}>
              <span>BE-4101</span><span>→</span><span>BE-4102</span><span>→</span><span>BE-4103</span><span>→</span><span>repeat</span>
            </div>
          </div>
          <div className="card p-4">
            <SectionLabel><span className="flex items-center gap-1.5"><Activity size={10} /> fairness invariant</span></SectionLabel>
            <p className="mono text-[10.5px]" style={{ color: "var(--dim)" }}>After any k requests, max(count) − min(count) ≤ 1. Current delta: <b className="text-white">{state ? Math.max(...Object.values(state.counts)) - Math.min(...Object.values(state.counts)) : 0}</b>.</p>
          </div>
        </div>

        <div className="card p-4 min-w-0 lg:col-span-2 xl:col-span-1">
          <SectionLabel right={<Badge tone="acc">{log.length} routes</Badge>}>Routing log</SectionLabel>
          <Terminal lines={log} height={500} />
        </div>
      </div>
    </div>
  );
}
