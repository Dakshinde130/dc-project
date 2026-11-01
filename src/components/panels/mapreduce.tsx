"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, BarChart3, Combine, Cpu, FileText, Play, Shuffle, Sigma } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, type LogLine } from "@/components/ui";

type Phase = "idle" | "split" | "map" | "shuffle" | "reduce" | "done";

interface WorkerStat {
  id: string;
  pid: number | null;
  assigned: number;
  activeChunk: number | null;
  chunks: number;
  words: number;
  keys: number;
  ms: number;
}

interface MRTop {
  w: string;
  c: number;
}

const WIDS = ["BE-4101", "BE-4102", "BE-4103"];

export default function MapReducePanel() {
  const [corpus, setCorpus] = useState<"logs" | "essay">("logs");
  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("normal");
  const [phase, setPhase] = useState<Phase>("idle");
  const [running, setRunning] = useState(false);
  const [docs, setDocs] = useState(0);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [workers, setWorkers] = useState<Record<string, WorkerStat>>({});
  const [shuffle, setShuffle] = useState<{ done: number; total: number; keys: string[] }>({ done: 0, total: 0, keys: [] });
  const [reduceP, setReduceP] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [top, setTop] = useState<MRTop[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [totals, setTotals] = useState<{ words: number; keys: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((l) => [...l, { kind, text }].slice(-90));
  }, []);

  /* elapsed ticker */
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - t0), 90);
    return () => clearInterval(t);
  }, [running]);

  useEffect(
    () => () => {
      esRef.current?.close();
    },
    []
  );

  const bumpWorker = useCallback((id: string, mut: (w: WorkerStat) => void) => {
    setWorkers((prev) => {
      const cur: WorkerStat = prev[id] ?? { id, pid: null, assigned: 0, activeChunk: null, chunks: 0, words: 0, keys: 0, ms: 0 };
      const next = { ...cur };
      mut(next);
      return { ...prev, [id]: next };
    });
  }, []);

  const run = useCallback(() => {
    if (running) return;
    esRef.current?.close();
    setPhase("idle");
    setDocs(0);
    setChunksTotal(0);
    setChunksDone(0);
    setWorkers({});
    setShuffle({ done: 0, total: 0, keys: [] });
    setReduceP({ done: 0, total: 0 });
    setTop([]);
    setTotals(null);
    setLog([]);
    setElapsed(0);
    setRunning(true);

    const rid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const es = new EventSource(`/api/mapreduce?corpus=${corpus}&speed=${speed}&runId=${rid}`);
    esRef.current = es;

    es.addEventListener("mrevent", (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as { kind?: string; data?: Record<string, unknown>; duplicate?: boolean };
      if (e.duplicate || !e.kind || !e.data) return;
      const d = e.data;
      switch (e.kind) {
        case "phase": {
          const p = String(d.phase) as Phase;
          setPhase(p);
          push("info", `── phase: ${p.toUpperCase()}${d.scheduler ? ` · scheduler=${d.scheduler}` : ""} ──`);
          break;
        }
        case "split":
          setDocs(Number(d.docs));
          setChunksTotal(Number(d.chunks));
          push("info", `split: ${d.docs} documents → ${d.chunks} chunks`);
          break;
        case "map-start": {
          const w = String(d.worker);
          bumpWorker(w, (x) => {
            x.assigned++;
            x.activeChunk = Number(d.chunk);
          });
          push("dim", `chunk ${d.chunk} → ${w} (slot rr=${d.rr})`);
          break;
        }
        case "map-done": {
          const w = String(d.worker);
          setChunksDone((c) => c + 1);
          bumpWorker(w, (x) => {
            x.chunks++;
            x.words += Number(d.words);
            x.keys += Number(d.keys);
            x.ms += Number(d.ms);
            x.activeChunk = null;
          });
          push("ok", `${w} mapped chunk ${d.chunk}: ${d.words} words → ${d.keys} keys in ${d.ms}ms`);
          break;
        }
        case "shuffle-batch":
          setShuffle((s) => ({ done: Number(d.done), total: Number(d.total), keys: [...(d.keys as string[]), ...s.keys].slice(0, 14) }));
          break;
        case "reduce-batch":
          setReduceP({ done: Number(d.done), total: Number(d.total) });
          break;
      }
    });
    es.addEventListener("done", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { result?: { top: MRTop[]; stats: { words: number; keys: number; perWorker: { id: string; pid: number | null }[]; elapsedMs: number } }; error?: string };
      if (d.result) {
        setTop(d.result.top);
        setTotals({ words: d.result.stats.words, keys: d.result.stats.keys });
        for (const w of d.result.stats.perWorker) bumpWorker(w.id, (x) => void (x.pid = w.pid));
        push("ok", `job complete in ${(d.result.stats.elapsedMs / 1000).toFixed(1)}s — ${d.result.stats.words} words, ${d.result.stats.keys} distinct keys`);
        setPhase("done");
      } else {
        push("err", `job failed: ${d.error}`);
      }
      es.close();
      esRef.current = null;
      setRunning(false);
    });
    es.onerror = () => {
      push("err", "stream error — server down?");
      es.close();
      esRef.current = null;
      setRunning(false);
    };
  }, [corpus, speed, running, push, bumpWorker]);

  const phases: { id: Phase; label: string }[] = [
    { id: "split", label: "SPLIT" },
    { id: "map", label: "MAP" },
    { id: "shuffle", label: "SHUFFLE" },
    { id: "reduce", label: "REDUCE" },
  ];
  const maxC = Math.max(1, ...top.map((t) => t.c));

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="phase" value={<span className="text-[13px] uppercase tracking-widest">{phase}</span>} tone={running ? "acc" : phase === "done" ? "ok" : undefined} />
        <Stat label="chunks mapped" value={`${chunksDone}${chunksTotal ? ` / ${chunksTotal}` : ""}`} sub="round-robin scheduled" />
        <Stat label="words counted" value={totals?.words ?? "—"} sub={totals ? `${totals.keys} distinct keys` : "real tokenizers"} />
        <Stat label="keys shuffled" value={shuffle.total || "—"} sub={shuffle.total ? `${shuffle.done} grouped` : ""} />
        <Stat label="elapsed" value={`${(elapsed / 1000).toFixed(1)}s`} sub={running ? "job running" : "idle"} />
      </div>

      {/* phase stepper */}
      <div className="flex items-center gap-2 flex-wrap">
        {phases.map((p, i) => {
          const active = phase === p.id;
          const done = phase === "done" || phases.findIndex((x) => x.id === phase) > i;
          return (
            <div key={p.id} className="flex items-center gap-2">
              <span
                className="mono text-[10px] tracking-[0.18em] px-3 py-1.5 rounded-md border transition-all"
                style={{
                  borderColor: active ? "rgba(255,255,255,.7)" : done ? "rgba(255,255,255,.3)" : "var(--line)",
                  background: active ? "rgba(255,255,255,.12)" : "transparent",
                  color: active ? "#fff" : done ? "#c9ced2" : "var(--faint)",
                  boxShadow: active ? "0 0 16px -6px rgba(255,255,255,.6)" : "none",
                }}
              >
                {p.label}
              </span>
              {i < phases.length - 1 && <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>→</span>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[300px_1fr_330px] gap-5">
        {/* controls */}
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Job control</SectionLabel>
            <div className="mono text-[9.5px] tracking-[0.18em] uppercase" style={{ color: "var(--faint)" }}>corpus</div>
            <div className="seg self-start">
              <button className={corpus === "logs" ? "on" : ""} onClick={() => !running && setCorpus("logs")}>server logs</button>
              <button className={corpus === "essay" ? "on" : ""} onClick={() => !running && setCorpus("essay")}>essay</button>
            </div>
            <div className="seg self-start">
              {(["slow", "normal", "fast"] as const).map((s) => (
                <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}</button>
              ))}
            </div>
            <button className="btn btn-acc justify-center" disabled={running} onClick={run}>
              {running ? <Combine size={12} /> : <Play size={12} />}
              {running ? "job running…" : "run mapreduce job"}
            </button>
          </div>
          <div className="field-note">
            <b>Genuinely distributed:</b> each chunk is POSTed to a real worker process that tokenizes it; chunks are assigned
            <b> round-robin</b> (that list item sneaks in here). Shuffle groups by key across mapper outputs; reduce sums. Every
            number below crossed a real process boundary — twice.
          </div>
        </div>

        {/* pipeline */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className="card p-4">
            <SectionLabel><span className="flex items-center gap-1.5"><FileText size={10} /> input</span></SectionLabel>
            <div className="flex items-center gap-3">
              <span className="mono tnum text-xl font-bold">{docs || "—"}</span>
              <span className="mono text-[10px]" style={{ color: "var(--dim)" }}>documents · {corpus === "logs" ? "ops log shards" : "essay sections"} → {chunksTotal || "…"} chunks</span>
            </div>
          </div>

          <ArrowDown size={13} className="self-center" style={{ color: "var(--faint)" }} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {WIDS.map((id) => {
              const w = workers[id];
              const pct = w && w.assigned > 0 ? (w.chunks / w.assigned) * 100 : 0;
              return (
                <div
                  key={id}
                  className="card p-3.5 flex flex-col gap-2"
                  style={w?.activeChunk != null ? { borderColor: "rgba(255,255,255,.5)", boxShadow: "0 0 20px -8px rgba(255,255,255,.5)" } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className={`led ${w?.activeChunk != null ? "acc" : w ? "on" : ""}`} />
                    <span className="mono text-[11px] font-bold">{id}</span>
                    <span className="mono ml-auto text-[9px]" style={{ color: "var(--faint)" }}><Cpu size={9} className="inline mr-1" />pid {w?.pid ?? "—"}</span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="mono grid grid-cols-3 gap-1 text-[9px]" style={{ color: "var(--dim)" }}>
                    <span className="flex flex-col"><b className="tnum text-white text-[11px]">{w?.chunks ?? 0}/{w?.assigned ?? 0}</b>chunks</span>
                    <span className="flex flex-col"><b className="tnum text-white text-[11px]">{w?.words ?? 0}</b>words</span>
                    <span className="flex flex-col"><b className="tnum text-white text-[11px]">{w ? w.ms.toFixed(0) : 0}</b>ms cpu</span>
                  </div>
                </div>
              );
            })}
          </div>

          <ArrowDown size={13} className="self-center" style={{ color: "var(--faint)" }} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="card p-3.5">
              <SectionLabel><span className="flex items-center gap-1.5"><Shuffle size={10} /> shuffle · group by key</span></SectionLabel>
              <div className="mono tnum text-lg font-bold">{shuffle.done}<span style={{ color: "var(--faint)" }}> / {shuffle.total || "…"} keys</span></div>
              <div className="flex flex-wrap gap-1 mt-2 min-h-[24px]">
                {shuffle.keys.map((k, i) => (
                  <span key={`${k}-${i}`} className="chip seq-chip" style={{ animationDelay: `${i * 30}ms` }}>{k}</span>
                ))}
              </div>
            </div>
            <div className="card p-3.5">
              <SectionLabel><span className="flex items-center gap-1.5"><Sigma size={10} /> reduce · Σ values</span></SectionLabel>
              <div className="mono tnum text-lg font-bold">{reduceP.done}<span style={{ color: "var(--faint)" }}> / {reduceP.total || "…"} keys</span></div>
              <div className="bar-track mt-3"><div className="bar-fill" style={{ width: reduceP.total ? `${(reduceP.done / reduceP.total) * 100}%` : "0%" }} /></div>
            </div>
          </div>

          <ArrowDown size={13} className="self-center" style={{ color: "var(--faint)" }} />

          <div className="card card-corners p-4">
            <SectionLabel right={<Badge tone="acc"><BarChart3 size={10} /> top {top.length}</Badge>}>output · word counts</SectionLabel>
            <div className="well rounded-lg p-3 min-h-[120px]">
              {top.length === 0 ? (
                <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>the final key→count table lands here</span>
              ) : (
                <div className="flex flex-col gap-[5px]">
                  {top.map((t, i) => (
                    <div key={t.w} className="flex items-center gap-2">
                      <span className="mono text-[10px] w-24 truncate text-right" style={{ color: "var(--dim)" }}>{t.w}</span>
                      <div className="flex-1 h-[14px] rounded-[3px]" style={{ background: "rgba(0,0,0,.4)", boxShadow: "inset 0 1px 3px rgba(0,0,0,.7)" }}>
                        <div
                          className="h-full rounded-[3px] seq-chip"
                          style={{
                            width: `${(t.c / maxC) * 100}%`,
                            background: `linear-gradient(180deg, rgba(255,255,255,${0.95 - i * 0.045}), rgba(255,255,255,${0.45 - i * 0.02}))`,
                            transition: "width .7s cubic-bezier(.3,1,.3,1)",
                            animationDelay: `${i * 60}ms`,
                          }}
                        />
                      </div>
                      <span className="mono tnum text-[10px] w-8 text-right font-bold">{t.c}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* log */}
        <div className="flex flex-col gap-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <div className="card p-4 flex-1 flex flex-col">
            <SectionLabel right={<Badge tone="acc">{log.length}</Badge>}>Job tracker</SectionLabel>
            <Terminal lines={log} height={470} />
          </div>
          <div className="card p-4">
            <SectionLabel>The idea</SectionLabel>
            <p className="mono text-[10px] leading-relaxed" style={{ color: "var(--dim)" }}>
              map is embarrassingly parallel — that&apos;s the whole trick. computation moves to the data, intermediate keys group by hash,
              reducers never talk to each other. you just watched 28 chunks × 2 HTTP calls ≈{" "}
              <b style={{ color: "#fff" }}>56 genuine RPCs</b> carry one job through 3 OS processes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
