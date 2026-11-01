import { getDeadlockLab } from "@/lib/lab/deadlock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(getDeadlockLab().snapshot());
}

export async function POST(req: Request) {
  const lab = getDeadlockLab();
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* default: step */
  }
  switch (body.action) {
    case "reset":
      return Response.json(lab.reset());
    case "recover":
      return Response.json(lab.armRecovery());
    case "step":
    default:
      return Response.json(lab.step());
  }
}
