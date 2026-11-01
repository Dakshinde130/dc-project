import { getRmiLab } from "@/lib/lab/legacy-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const METHODS = new Set(["add", "multiply", "fibonacci", "describe", "missingMethod"]);

export async function GET() {
  return Response.json(getRmiLab().stats());
}

export async function POST(req: Request) {
  const lab = getRmiLab();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    method?: string;
    args?: (string | number)[];
    forceLookup?: boolean;
  };
  try {
    if (body.action === "reset") {
      lab.reset();
      return Response.json(lab.stats());
    }
    if (body.action === "lookup") return Response.json(await lab.lookup(!!body.forceLookup));
    const method = body.method && METHODS.has(body.method) ? body.method : "describe";
    return Response.json(await lab.invoke(method, Array.isArray(body.args) ? body.args.slice(0, 6) : [], !!body.forceLookup));
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
