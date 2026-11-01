/**
 * MiniMapReduce — a real distributed MapReduce job.
 *
 * split → map (chunks are POSTed round-robin to the three worker processes,
 * which genuinely tokenize & count) → shuffle (keys grouped in the control
 * plane) → reduce (sum). Progress streams out as events for the dashboard.
 */
import { getBackendManager } from "./backends";

export type CorpusId = "logs" | "essay";

export interface MREvent {
  kind:
    | "phase"
    | "split"
    | "map-start"
    | "map-done"
    | "shuffle-batch"
    | "reduce-batch"
    | "complete";
  data: Record<string, unknown>;
  atMs: number;
}

export interface MRResult {
  top: { w: string; c: number }[];
  stats: {
    docs: number;
    words: number;
    keys: number;
    chunks: number;
    elapsedMs: number;
    perWorker: { id: string; pid: number | null; chunks: number; words: number; keys: number; ms: number }[];
  };
}

/* ------------------------------- corpora -------------------------------- */

function buildLogs(): string[] {
  const levels = ["INFO", "INFO", "INFO", "WARN", "ERROR", "DEBUG"];
  const routes = ["/api/orders", "/api/login", "/api/search", "/api/pay", "/api/cart", "/api/users"];
  const msgs = ["ok", "timeout", "retry", "cache hit", "cache miss", "failover", "commit", "rollback"];
  const docs: string[] = [];
  for (let d = 0; d < 14; d++) {
    const lines: string[] = [];
    for (let i = 0; i < 34; i++) {
      const lv = levels[Math.floor(Math.random() * levels.length)];
      const r = routes[Math.floor(Math.random() * routes.length)];
      const m = msgs[Math.floor(Math.random() * msgs.length)];
      lines.push(`2026-02-02T1${i % 9}:${(i * 7) % 60}z ${lv} ${r} ${m} worker${(d % 3) + 1} shard${i % 4} rtt ${10 + ((i * 37) % 90)}ms`);
    }
    docs.push(lines.join("\n"));
  }
  return docs;
}

const VOCAB =
  "distributed systems trade consistency for availability clocks drift networks partition messages drop leaders emerge consensus forms replicas converge queues absorb bursts backpressure protects services degrade gracefully idempotent retries hide failure partial failure defines the discipline".split(" ");

function buildEssay(): string[] {
  const docs: string[] = [];
  for (let d = 0; d < 14; d++) {
    const paras: string[] = [];
    for (let p = 0; p < 3; p++) {
      const s: string[] = [];
      for (let i = 0; i < 42; i++) {
        s.push(VOCAB[Math.floor(Math.random() * VOCAB.length)]);
        if (i % 9 === 8) s.push(".");
      }
      paras.push(s.join(" "));
    }
    docs.push(paras.join("\n\n"));
  }
  return docs;
}

const CORPORA: Record<CorpusId, { label: string; docs: string[] }> = {
  logs: { label: "server logs · 14 shards", docs: buildLogs() },
  essay: { label: "essay · 14 sections", docs: buildEssay() },
};

export function corpusMeta() {
  return {
    logs: { id: "logs" as const, label: CORPORA.logs.label, docs: CORPORA.logs.docs.length },
    essay: { id: "essay" as const, label: CORPORA.essay.label, docs: CORPORA.essay.docs.length },
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface RunOpts {
  corpus: CorpusId;
  speed: "slow" | "normal" | "fast";
  emit: (e: Omit<MREvent, "atMs">) => void;
}

export async function runMapReduce(opts: RunOpts): Promise<MRResult> {
  const mgr = getBackendManager();
  await mgr.ensureStarted();
  const t0 = Date.now();
  const pace = opts.speed === "slow" ? 2 : opts.speed === "fast" ? 0.35 : 1;
  const docs = CORPORA[opts.corpus].docs;

  /* ---- split ---- */
  opts.emit({ kind: "phase", data: { phase: "split" } });
  const chunks: { chunk: number; text: string }[] = [];
  docs.forEach((doc, i) => {
    const half = Math.ceil(doc.length / 2);
    chunks.push({ chunk: i * 2, text: doc.slice(0, half) });
    chunks.push({ chunk: i * 2 + 1, text: doc.slice(half) });
  });
  opts.emit({ kind: "split", data: { chunks: chunks.length, docs: docs.length } });
  await sleep(320 * pace);

  /* ---- map (round-robin scheduling across real worker processes) ---- */
  opts.emit({ kind: "phase", data: { phase: "map", scheduler: "round-robin" } });
  const perWorker = mgr.backends.map((b) => ({ id: b.id, pid: b.pid as number | null, chunks: 0, words: 0, keys: 0, ms: 0 }));
  const partials: Record<string, number>[] = [];
  let cursor = 0;
  const queue = [...chunks];
  const workersLive = mgr.backends;

  await Promise.all(
    workersLive.map(async (b, wi) => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        const assigned = cursor % workersLive.length;
        cursor++;
        const target = workersLive[assigned];
        void wi;
        opts.emit({ kind: "map-start", data: { chunk: item.chunk, worker: target.id, rr: assigned } });
        const r = await fetch(`http://127.0.0.1:${target.port}/map`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chunk: item.chunk, text: item.text }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        const j = (await r.json()) as {
          counts: Record<string, number>;
          words: number;
          keys: number;
          wallMs: number;
          worker: string;
          pid: number;
        };
        partials.push(j.counts);
        const w = perWorker.find((x) => x.id === target.id)!;
        w.chunks++;
        w.words += j.words;
        w.keys += j.keys;
        w.ms += j.wallMs;
        w.pid = j.pid;
        opts.emit({
          kind: "map-done",
          data: { chunk: item.chunk, worker: target.id, words: j.words, keys: j.keys, ms: Math.round(j.wallMs * 10) / 10 },
        });
        await sleep(90 * pace);
      }
    })
  );

  /* ---- shuffle ---- */
  opts.emit({ kind: "phase", data: { phase: "shuffle" } });
  const grouped = new Map<string, number[]>();
  let pairs = 0;
  let words = 0;
  for (const p of partials) {
    for (const [k, v] of Object.entries(p)) {
      const arr = grouped.get(k) ?? [];
      arr.push(v);
      grouped.set(k, arr);
      pairs++;
      words += v;
    }
  }
  const keys = [...grouped.keys()];
  for (let i = 0; i < keys.length; i += 12) {
    opts.emit({
      kind: "shuffle-batch",
      data: { keys: keys.slice(i, i + 12), done: Math.min(i + 12, keys.length), total: keys.length },
    });
    await sleep(70 * pace);
  }

  /* ---- reduce ---- */
  opts.emit({ kind: "phase", data: { phase: "reduce" } });
  const totals: [string, number][] = [];
  let done = 0;
  for (const [k, arr] of grouped) {
    totals.push([k, arr.reduce((s, v) => s + v, 0)]);
    done++;
    if (done % 24 === 0) {
      opts.emit({ kind: "reduce-batch", data: { done, total: grouped.size } });
      await sleep(60 * pace);
    }
  }
  totals.sort((a, b) => b[1] - a[1]);
  const top = totals.slice(0, 16).map(([w, c]) => ({ w, c }));

  const result: MRResult = {
    top,
    stats: {
      docs: docs.length,
      words,
      keys: grouped.size,
      chunks: chunks.length,
      elapsedMs: Date.now() - t0,
      perWorker,
    },
  };
  opts.emit({ kind: "complete", data: { result } });
  return result;
}
