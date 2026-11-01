import { getXmlRpcLab } from "@/lib/lab/legacy-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED = new Set(["math.add", "math.multiply", "system.echo", "stats.summary", "unknown.method"]);

export async function GET() {
  return Response.json(getXmlRpcLab().stats());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { method?: string; params?: (string | number | boolean)[] };
  const method = body.method && ALLOWED.has(body.method) ? body.method : "system.echo";
  const params = Array.isArray(body.params) ? body.params.slice(0, 8) : ["hello xml-rpc"];
  try {
    return Response.json(await getXmlRpcLab().call(method, params));
  } catch (e) {
    return Response.json({ ok: false, fault: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
