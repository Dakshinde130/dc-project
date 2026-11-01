import { getBerkeleyLab } from "@/lib/lab/berkeley";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const lab = getBerkeleyLab();
  const { coordinator, nodes } = await lab.readClocks();
  return Response.json({
    coordinator,
    nodes,
    round: lab.round,
    lastRound: lab.lastRound,
    history: lab.history,
    auto: lab.auto,
    autoMs: lab.autoMs,
  });
}

export async function POST(req: Request) {
  const lab = getBerkeleyLab();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    ppm?: number;
    on?: boolean;
    ms?: number;
  };
  switch (body.action) {
    case "sync":
      return Response.json(await lab.sync());
    case "drift":
      if (body.id && typeof body.ppm === "number") await lab.setDrift(body.id, body.ppm);
      return Response.json({ ok: true });
    case "auto":
      lab.setAuto(!!body.on, body.ms);
      return Response.json({ ok: true, auto: lab.auto });
    case "reset":
      await lab.resetTotals();
      return Response.json({ ok: true });
    default:
      return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}
