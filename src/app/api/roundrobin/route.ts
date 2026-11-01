import { getRoundRobinLab } from "@/lib/lab/roundrobin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getRoundRobinLab().status());
}

export async function POST(req: Request) {
  const lab = getRoundRobinLab();
  const body = (await req.json().catch(() => ({}))) as { action?: string; count?: number; slow?: boolean };
  if (body.action === "slow") {
    await lab.setSlow(!!body.slow);
    return Response.json(await lab.status());
  }
  if (body.action === "reset") {
    await lab.reset();
    return Response.json(await lab.status());
  }
  if (body.action === "burst") {
    const count = Math.max(1, Math.min(60, body.count ?? 12));
    return Response.json({ decisions: await Promise.all(Array.from({ length: count }, () => lab.route())) });
  }
  return Response.json(await lab.route());
}
