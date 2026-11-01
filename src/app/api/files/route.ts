import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = "/tmp/dslab-share";
const MAX_BYTES = 8 * 1024 * 1024;

function safeToken(v: string) {
  return v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}
function safeName(v: string) {
  return path.basename(v).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "shared.bin";
}
async function ready() {
  await mkdir(ROOT, { recursive: true });
}
async function listFiles() {
  await ready();
  const names = (await readdir(ROOT)).filter((n) => !n.startsWith(".part-") && !n.endsWith(".json"));
  return Promise.all(
    names.map(async (diskName) => {
      const sep = diskName.indexOf("--");
      const id = sep >= 0 ? diskName.slice(0, sep) : diskName;
      const name = sep >= 0 ? diskName.slice(sep + 2) : diskName;
      const st = await stat(path.join(ROOT, diskName));
      const data = await readFile(path.join(ROOT, diskName));
      return { id, name, size: st.size, createdAt: st.mtimeMs, sha256: createHash("sha256").update(data).digest("hex") };
    })
  );
}

export async function GET(req: Request) {
  await ready();
  const url = new URL(req.url);
  const download = url.searchParams.get("download");
  if (!download) return Response.json({ files: await listFiles(), maxBytes: MAX_BYTES, chunkBytes: 192 * 1024 });
  const id = safeToken(download);
  const disk = (await readdir(ROOT)).find((n) => n.startsWith(`${id}--`) && !n.endsWith(".json"));
  if (!disk) return Response.json({ error: "file not found" }, { status: 404 });
  const data = await readFile(path.join(ROOT, disk));
  const name = disk.slice(disk.indexOf("--") + 2);
  return new Response(data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      "Content-Length": String(data.length),
    },
  });
}

export async function POST(req: Request) {
  await ready();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    uploadId?: string;
    name?: string;
    index?: number;
    total?: number;
    data?: string;
    id?: string;
  };

  if (body.action === "delete") {
    const id = safeToken(body.id ?? "");
    const disk = (await readdir(ROOT)).find((n) => n.startsWith(`${id}--`) && !n.endsWith(".json"));
    if (disk) await unlink(path.join(ROOT, disk)).catch(() => undefined);
    return Response.json({ ok: true, files: await listFiles() });
  }

  if (body.action === "clear") {
    await Promise.all((await readdir(ROOT)).map((n) => unlink(path.join(ROOT, n)).catch(() => undefined)));
    return Response.json({ ok: true, files: [] });
  }

  if (body.action !== "chunk") return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  const uploadId = safeToken(body.uploadId ?? "");
  const name = safeName(body.name ?? "shared.bin");
  const index = Math.max(0, Number(body.index) || 0);
  const total = Math.max(1, Math.min(100, Number(body.total) || 1));
  if (!uploadId || typeof body.data !== "string") return Response.json({ ok: false, error: "invalid chunk" }, { status: 400 });
  const chunk = Buffer.from(body.data, "base64");
  const part = path.join(ROOT, `.part-${uploadId}`);
  if (index === 0) await writeFile(part, chunk);
  else await appendFile(part, chunk);
  const st = await stat(part);
  if (st.size > MAX_BYTES) {
    await unlink(part).catch(() => undefined);
    return Response.json({ ok: false, error: "file exceeds 8 MiB" }, { status: 413 });
  }
  const complete = index === total - 1;
  let file = null;
  if (complete) {
    const finalName = `${uploadId}--${name}`;
    await rename(part, path.join(ROOT, finalName));
    const data = await readFile(path.join(ROOT, finalName));
    file = { id: uploadId, name, size: data.length, createdAt: Date.now(), sha256: createHash("sha256").update(data).digest("hex") };
  }
  return Response.json({ ok: true, index, total, received: st.size, complete, file });
}
