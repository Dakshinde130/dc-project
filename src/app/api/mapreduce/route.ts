import { corpusMeta, runMapReduce, type CorpusId } from "@/lib/lab/mapreduce";
import { getGlobal } from "@/lib/lab/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Registry {
  activeRunId: string | null;
  lastRunId: string | null;
  finishedAt: number;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const corpus: CorpusId = url.searchParams.get("corpus") === "essay" ? "essay" : "logs";
  const sp = url.searchParams.get("speed");
  const speed = sp === "slow" || sp === "fast" ? sp : "normal";
  const runId = url.searchParams.get("runId") ?? "anon";

  const registry = getGlobal<Registry>("dslab.mrRegistry", () => ({
    activeRunId: null,
    lastRunId: null,
    finishedAt: 0,
  }));

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      if (registry.activeRunId === runId || (registry.lastRunId === runId && Date.now() - registry.finishedAt < 2000)) {
        send("mrevent", { duplicate: true });
        controller.close();
        return;
      }
      registry.activeRunId = runId;

      const hb = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: hb\n\n`));
        } catch {
          /* closed */
        }
      }, 1000);

      send("meta", { corpora: corpusMeta() });
      const t0 = Date.now();
      runMapReduce({
        corpus,
        speed,
        emit: (e) => send("mrevent", { ...e, atMs: Date.now() - t0 }),
      })
        .then((result) => send("done", { result }))
        .catch((e) => send("done", { error: e instanceof Error ? e.message : String(e) }))
        .finally(() => {
          clearInterval(hb);
          registry.activeRunId = null;
          registry.lastRunId = runId;
          registry.finishedAt = Date.now();
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
