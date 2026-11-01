"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Antenna, RotateCcw, RotateCw, Wind } from "lucide-react";
import { Badge, NeonSlider, SectionLabel, Stat, Terminal, Toggle, type LogLine } from "@/components/ui";

interface UdpEvent {
  n: number;
  seq: number;
  kind: string;
  value: string | number;
  latencyMs: number;
  gapLost: number;
  ts: number;
}

interface UdpStats {
  pid: number | null;
  running: boolean;
  rateMs: number;
  lossPct: number;
  rx: number;
  lostEst: number;
  lastSeq: number;
  lastLatencyMs: number;
  byKind: Record<string, number>;
  events: UdpEvent[];
}

const TILES = 56;

export default function UdpPanel() {
  const [stats, setStats] = useState<UdpStats | null>(null);
  const [seen, setSeen] = useState<Map<number, number>>(new Map());
  const [lost, setLost] = useState<Set<number>>(new Set());
  const [log, setLog] = useState<LogLine[]>([]);
  const seenRef = useRef(seen);
  const lostRef = useRef(lost);

  const ingest = useCallback((e: UdpEvent) => {
    const s = new Map(seenRef.current);
    const ls = new Set(lostRef.current);
    for (let g = e.seq - e.gapLost; g < e.seq; g++) {
      ls.add(g);
      s.delete(g);
    }
    s.set(e.seq, e.latencyMs);
    // trim memory
    const maxSeq = e.seq;
    for (const k of s.keys()) if (k < maxSeq - 160) s.delete(k);
    for (const k of ls) if (k < maxSeq - 160) ls.delete(k);
    seenRef.current = s;
    lostRef.current = ls;
    setSeen(s);
    setLost(ls);
    setLog((l) =>
      [
        ...l,
        ...(e.gapLost > 0
          ? [
              {
                kind: "err" as const,
                text: `LOST: seq ${e.seq - e.gapLost}…${e.seq - 1} never arrived (${e.gapLost} datagram${e.gapLost > 1 ? "s" : ""}) — no retransmit, no apology`,
              },
            ]
          : []),
        { kind: e.kind === "alert" ? ("warn" as const) : ("dim" as const), text: `seq ${String(e.seq).padStart(4, "0")} · ${e.kind} · ${String(e.value).slice(0, 30)} · ${e.latencyMs}ms` },
      ].slice(-90)
    );
  }, []);

  /* SSE subscription */
  useEffect(() => {
    const es = new EventSource("/api/udp");
    es.addEventListener("stats", (ev) => {
      const s = JSON.parse((ev as MessageEvent).data) as UdpStats;
      if (s.events.length > 0 && seenRef.current.size === 0 && lostRef.current.size === 0) {
        s.events.forEach(ingest);
      }
      setStats(s);
    });
    es.addEventListener("datagram", (ev) => ingest(JSON.parse((ev as MessageEvent).data) as UdpEvent));
    return () => es.close();
  }, [ingest]);

  const configure = useCallback(async (patch: Record<string, unknown>) => {
    const r = await fetch("/api/udp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setStats(await r.json());
  }, []);

  const running = stats?.running ?? false;
  const rateMs = stats?.rateMs ?? 220;
  const lossPct = stats?.lossPct ?? 10;
  const rx = stats?.rx ?? 0;
  const lostEst = stats?.lostEst ?? 0;
  const measuredLoss = rx + lostEst > 0 ? (lostEst / (rx + lostEst)) * 100 : 0;

  const maxSeq = stats?.lastSeq ?? 0;
  const tiles = Array.from({ length: TILES }, (_, i) => maxSeq - TILES + 1 + i).filter((s) => s > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* stat strip */}
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="datagrams received" value={rx} sub={`udp :5201`} />
        <Stat label="lost (seq gaps)" value={lostEst} tone={lostEst > 0 ? "warn" : undefined} sub="never retransmitted" />
        <Stat label="measured loss" value={`${measuredLoss.toFixed(1)}%`} tone={lostEst > 0 ? "warn" : "ok"} sub={`injected ${lossPct}%`} />
        <Stat label="emit rate" value={`${rateMs}ms`} sub={running ? "streaming" : "paused"} />
        <Stat label="notifier pid" value={stats?.pid ?? "booting…"} sub={`:5202 control channel`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[300px_1fr_330px] gap-5">
        {/* controls */}
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-5">
            <SectionLabel>Notifier control</SectionLabel>
            <Toggle on={running} onChange={(v) => configure({ running: v })} label="EMIT DATAGRAMS" hint={running ? "streaming to :5201" : "paused"} />
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="mono text-[10px] tracking-[0.15em]" style={{ color: "var(--faint)" }}>EMIT INTERVAL</span>
                <span className="mono tnum text-[11px]" style={{ color: "var(--dim)" }}>{rateMs}ms</span>
              </div>
              <NeonSlider value={rateMs} min={50} max={800} onChange={(v) => configure({ rateMs: v })} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="mono text-[10px] tracking-[0.15em]" style={{ color: "var(--faint)" }}>
                  <span className="flex items-center gap-1.5"><Wind size={10} /> INJECTED LOSS</span>
                </span>
                <span className="mono tnum text-[11px]" style={{ color: "var(--dim)" }}>{lossPct}%</span>
              </div>
              <NeonSlider value={lossPct} min={0} max={50} onChange={(v) => configure({ lossPct: v })} />
            </div>
            <button
              className="btn self-start"
              onClick={() => {
                seenRef.current = new Map();
                lostRef.current = new Set();
                setSeen(new Map());
                setLost(new Set());
                setLog([]);
                configure({ reset: true });
              }}
            >
              <RotateCcw size={12} /> reset counters
            </button>
          </div>

          <div className="field-note">
            <b>No handshake. No retransmit. No ordering.</b> Each tile in the strip is one sequence number; a hollow tile is a datagram
            that never showed up. The receiver reconstructs loss purely from gaps — exactly how real telemetry pipelines detect UDP loss.
            Config itself travels back over UDP on <span className="mono">:5202</span>.
          </div>
        </div>

        {/* sequence strip */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="card card-corners p-4">
            <SectionLabel
              right={
                <span className="flex items-center gap-3 mono text-[9px]" style={{ color: "var(--faint)" }}>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[2px] bg-white" /> arrived</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[2px] border border-dashed border-white/60" style={{ animation: "ledblink .8s infinite" }} /> lost</span>
                </span>
              }
            >
              Sequence space · live
            </SectionLabel>
            <div className="well rounded-lg p-3">
              {tiles.length === 0 ? (
                <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>
                  press EMIT DATAGRAMS — every tile is one sequence number, hollow ones are the ones UDP dropped
                </span>
              ) : (
                <div className="grid gap-[4px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(26px, 1fr))" }}>
                  {tiles.map((seq) => {
                    const got = seen.has(seq);
                    const gone = lost.has(seq);
                    return (
                      <div
                        key={seq}
                        title={got ? `seq ${seq} · ${seen.get(seq)}ms` : gone ? `seq ${seq} — lost` : `seq ${seq}`}
                        className="mono tnum rounded-[4px] text-center text-[8.5px] leading-[26px] panel-enter"
                        style={
                          got
                            ? {
                                background: "linear-gradient(180deg,#fff,#b9bdc1)",
                                color: "#0a0a0b",
                                fontWeight: 700,
                                boxShadow: "0 0 10px -3px rgba(255,255,255,.5)",
                              }
                            : gone
                              ? {
                                  border: "1px dashed rgba(255,255,255,.55)",
                                  color: "rgba(255,255,255,.35)",
                                  animation: "ledblink .8s ease-in-out infinite",
                                }
                              : { border: "1px solid rgba(255,255,255,.1)", color: "var(--faint)" }
                        }
                      >
                        {seq % 1000}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(stats?.byKind ?? {}).map(([k, v]) => (
                <span key={k} className="chip">
                  <Antenna size={9} /> {k} <b className="tnum text-white">{v}</b>
                </span>
              ))}
              {Object.keys(stats?.byKind ?? {}).length === 0 && <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>kind histogram appears with traffic</span>}
            </div>
          </div>

          <div className="card p-4">
            <SectionLabel>Why sequence numbers?</SectionLabel>
            <p className="mono text-[10.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
              UDP gives you nothing: no connection, no ACK, no guarantee. Adding a counter to each payload is the classic minimal fix —
              receivers tolerate loss (metrics, VoIP, game state) and simply notice the holes. When you need the holes filled, you reach for TCP — module 01.
            </p>
          </div>
        </div>

        {/* feed */}
        <div className="flex flex-col gap-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card p-4 flex-1 flex flex-col">
            <SectionLabel right={<Badge tone="acc">sse ← udp</Badge>}>Datagram feed</SectionLabel>
            <Terminal lines={log} height={450} />
          </div>
          <button className="btn self-start" onClick={() => configure({})}>
            <RotateCw size={12} /> refresh stats
          </button>
        </div>
      </div>
    </div>
  );
}
