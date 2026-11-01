import { getRicartLab } from "@/lib/lab/ricart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(getRicartLab().snapshot());
}

export async function POST(req: Request) {
  const lab = getRicartLab();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    node?: number;
    on?: boolean;
    speed?: "slow" | "normal" | "fast";
  };
  switch (body.action) {
    case "request":
      if (typeof body.node === "number") void lab.requestCS(body.node);
      break;
    case "auto":
      lab.setAuto(!!body.on);
      break;
    case "speed":
      if (body.speed) lab.setSpeed(body.speed);
      break;
    case "reset":
      lab.reset();
      break;
  }
  return Response.json(lab.snapshot());
}
