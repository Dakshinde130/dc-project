import { getTcpManager } from "@/lib/lab/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getTcpManager().getStats());
}

export async function POST(req: Request) {
  const mgr = getTcpManager();
  let body: { action?: string; payload?: string; pooled?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* default */
  }
  if (body.action === "reset") {
    mgr.reset();
    return Response.json(await mgr.getStats());
  }
  const payload = typeof body.payload === "string" && body.payload ? body.payload.slice(0, 240) : "hello broker";
  const result = await mgr.send(payload, !!body.pooled);
  return Response.json(result);
}
