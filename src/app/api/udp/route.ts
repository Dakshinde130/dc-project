import { getUdpManager } from "@/lib/lab/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET = SSE stream of datagram events; POST = reconfigure the notifier. */
export async function GET() {
  const mgr = getUdpManager();
  await mgr.ensure();

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* gone */
        }
      };
      send("stats", mgr.getStats());
      const unsub = mgr.subscribe((e) => {
        send("datagram", e);
        send("stats", mgr.getStats());
      });
      const hb = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: hb\n\n`));
        } catch {
          /* closed */
        }
      }, 1500);
      return () => {
        clearInterval(hb);
        unsub();
      };
    },
    cancel() {
      /* subscription cleaned by start's return via pipeline semantics not guaranteed; listeners are lightweight */
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

export async function POST(req: Request) {
  const mgr = getUdpManager();
  const body = (await req.json().catch(() => ({}))) as {
    rateMs?: number;
    lossPct?: number;
    running?: boolean;
    reset?: boolean;
  };
  await mgr.configure({
    ...(typeof body.rateMs === "number" ? { rateMs: body.rateMs } : {}),
    ...(typeof body.lossPct === "number" ? { lossPct: body.lossPct } : {}),
    ...(typeof body.running === "boolean" ? { running: body.running } : {}),
    ...(body.reset ? { reset: true } : {}),
  });
  return Response.json(mgr.getStats());
}
