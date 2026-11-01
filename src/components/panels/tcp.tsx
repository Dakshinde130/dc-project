"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cable, Plug, PlugZap, RotateCcw, Send, Zap } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, type LogLine } from "@/components/ui";

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

interface SendResult {
  id: number;
  mode: "fresh" | "pooled";
  rttMs: number;
  bytes: number;
  serverSeq: number;
  ok: boolean;
  error?: string;
}

function tsNow() {
  const d = new Date();
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(2, "0")}`;
}

export default function TcpPanel() {
  const [stats, setStats] = useState<TcpStats | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [payload, setPayload] = useState("hello over the wire");
  const [pooled, setPooled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [jolt, setJolt] = useState(0);
  const pooledRef = useRef(pooled);
  pooledRef.current = pooled;

  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/tcp", { cache: "no-store" });
        if (!dead) setStats(await r.json());
      } catch {
        /* booting */
      }
    };
    tick();
    const t = setInterval(tick, 900);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const sendOne = useCallback(async () => {
    setJolt((j) => j + 1);
    const r = await fetch("/api/tcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", payload, pooled }),
    });
    const d = (await r.json()) as SendResult;
    setLog((l) =>
      [
        ...l,
        d.ok
          ? {
              kind: "ok" as const,
              ts: tsNow(),
              text: `MSG #${d.id} → ACK bytes=${d.bytes} brokerSeq=${d.serverSeq} · ${d.rttMs}ms · ${d.mode === "pooled" ? "reused socket" : "fresh handshake"}`,
            }
          : { kind: "err" as const, ts: tsNow(), text: `#${d.id} failed — ${d.error}` },
      ].slice(-120)
    );
  }, [payload, pooled]);

  const burst = useCallback(async (n: number) => {
    setBusy(true);
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => void sendOne(), i * 70);
    }
    window.setTimeout(() => setBusy(false), n * 70 + 200);
  }, [sendOne]);

  const broker = stats?.broker ?? null;
  const rtts = stats?.lastRtts ?? [];
  const maxRtt = Math.max(3, ...rtts.map((r) => r.ms));

  return (
    <div className="flex flex-col gap-5">
      {/* stat strip */}
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="messages sent" value={stats?.sent ?? 0} sub={`${stats?.errors ?? 0} failed`} />
        <Stat label="avg rtt · fresh" value={stats?.avgRttFresh != null ? `${stats.avgRttFresh}ms` : "—"} sub="handshake each time" />
        <Stat label="avg rtt · pooled" value={stats?.avgRttPooled != null ? `${stats.avgRttPooled}ms` : "—"} tone="acc" sub="reused socket" />
        <Stat label="broker pid" value={stats?.pid ?? "booting…"} sub="tcp://127.0.0.1:5101" />
        <Stat
          label="connections"
          value={broker ? String(broker.connectionsTotal) : "—"}
          sub={broker ? `${broker.connectionsActive} active · ${broker.connsReused} reused` : "…"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[300px_1fr_330px] gap-5">
        {/* controls */}
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Message console</SectionLabel>
            <input
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              maxLength={120}
              className="well rounded-lg px-3 py-2.5 mono text-[12px] outline-none text-white"
              style={{ background: "var(--well)" }}
              placeholder="payload…"
            />
            <div className="seg self-start">
              <button className={!pooled ? "on" : ""} onClick={() => setPooled(false)}>
                <span className="flex items-center gap-1.5"><Plug size={10} /> fresh conn</span>
              </button>
              <button className={pooled ? "on" : ""} onClick={() => setPooled(true)}>
                <span className="flex items-center gap-1.5"><PlugZap size={10} /> pooled</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-acc" disabled={busy} onClick={() => sendOne()}>
                <Send size={12} /> send
              </button>
              <button className="btn" disabled={busy} onClick={() => burst(8)}>
                <Zap size={12} /> burst ×8
              </button>
              <button className="btn" disabled={busy} onClick={() => burst(24)}>
                <Zap size={12} /> ×24
              </button>
            </div>
            <button
              className="btn self-start"
              onClick={() => {
                setLog([]);
                fetch("/api/tcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
              }}
            >
              <RotateCcw size={12} /> reset
            </button>
          </div>

          <div className="field-note">
            <b>Wire protocol:</b> <span className="mono">MSG|id|payload</span> → <span className="mono">ACK|id|bytes|seq</span>, newline-framed over raw
            TCP. Watch the chart: <b>fresh</b> pays a full connect handshake per message; <b>pooled</b> amortizes it — the core argument for HTTP
            keep-alive and connection pools.
          </div>
        </div>

        {/* center: wire + rtt chart */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="card card-corners p-4">
            <SectionLabel right={<Badge tone="acc">raw tcp · no http</Badge>}>The wire</SectionLabel>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 560 }}>
                <svg viewBox="0 0 720 130" className="w-full" style={{ display: "block" }}>
                  <line x1="120" y1="65" x2="600" y2="65" className="edge-line" stroke="rgba(255,255,255,.3)" strokeDasharray="4 6" style={{ animation: "dashmove 1.4s linear infinite" }} />
                  {jolt > 0 && (
                    <circle key={jolt} r="4" fill="#fff">
                      <animateMotion dur="0.45s" path="M 120 65 L 600 65" fill="freeze" />
                      <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="0.9s" fill="freeze" />
                    </circle>
                  )}
                  <g>
                    <rect x="26" y="40" width="94" height="50" rx="10" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.35)" />
                    <text x="73" y="61" textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fontWeight="700" fill="#eceff1">CONTROL</text>
                    <text x="73" y="76" textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="#5d646b">:3000</text>
                  </g>
                  <g>
                    <rect x="600" y="38" width="96" height="54" rx="10" fill="rgba(255,255,255,.04)" stroke="#eceff1" strokeWidth="1.4" style={{ filter: "drop-shadow(0 0 12px rgba(255,255,255,.25))" }} />
                    <text x="648" y="60" textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fontWeight="700" fill="#fff">BROKER</text>
                    <text x="648" y="76" textAnchor="middle" fontSize="8.5" fontFamily="var(--font-mono)" fill="#5d646b">pid {stats?.pid ?? "—"}</text>
                  </g>
                </svg>
              </div>
            </div>
          </div>

          <div className="card p-4">
            <SectionLabel
              right={
                <span className="flex items-center gap-3 mono text-[9px]" style={{ color: "var(--faint)" }}>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: "#fff" }} /> fresh</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[2px] border border-white/60" /> pooled</span>
                </span>
              }
            >
              Round-trip time · last {rtts.length} messages
            </SectionLabel>
            <div className="well rounded-lg p-3">
              <div className="flex items-end gap-[3px] h-[110px]">
                {rtts.length === 0 && <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>send a few messages — each bar is one round trip</span>}
                {rtts.map((r, i) => (
                  <div
                    key={i}
                    title={`${r.mode} · ${r.ms}ms`}
                    className="flex-1 rounded-[2px]"
                    style={{
                      height: `${Math.max(6, (r.ms / maxRtt) * 100)}%`,
                      background: r.mode === "fresh" ? "linear-gradient(180deg,#fff,#9ba0a5)" : "transparent",
                      border: r.mode === "pooled" ? "1px solid rgba(255,255,255,.6)" : "1px solid transparent",
                      opacity: 0.5 + (0.5 * i) / Math.max(1, rtts.length),
                      transition: "height .25s ease",
                    }}
                  />
                ))}
              </div>
            </div>
            {stats && stats.avgRttFresh != null && stats.avgRttPooled != null && (
              <p className="mono mt-3 text-[10px]" style={{ color: "var(--dim)" }}>
                pooled is <b style={{ color: "#fff" }}>{(stats.avgRttFresh / Math.max(0.1, stats.avgRttPooled)).toFixed(1)}× faster</b> on this loopback — across a WAN the gap is an order of magnitude wider.
              </p>
            )}
          </div>
        </div>

        {/* log */}
        <div className="flex flex-col gap-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card p-4 flex-1 flex flex-col">
            <SectionLabel right={<Badge tone="acc">{log.length} acks</Badge>}>Broker ACKs</SectionLabel>
            <Terminal lines={log} height={420} />
          </div>
          <div className="card p-4">
            <SectionLabel>
              <span className="flex items-center gap-1.5"><Cable size={10} /> broker side</span>
            </SectionLabel>
            <div className="mono grid grid-cols-2 gap-2 text-[10px]" style={{ color: "var(--dim)" }}>
              <span>messages: <b className="text-white tnum">{broker?.messages ?? "—"}</b></span>
              <span>bytes rx: <b className="text-white tnum">{broker?.bytesRx ?? "—"}</b></span>
              <span>conns opened: <b className="text-white tnum">{broker?.connectionsTotal ?? "—"}</b></span>
              <span>multi-msg conns: <b className="text-white tnum">{broker?.connsReused ?? "—"}</b></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
