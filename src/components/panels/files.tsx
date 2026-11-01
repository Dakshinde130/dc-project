"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, File, FileUp, FolderOpen, RotateCcw, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, type LogLine } from "@/components/ui";

interface SharedFile { id: string; name: string; size: number; createdAt: number; sha256: string }
interface ListResponse { files: SharedFile[]; maxBytes: number; chunkBytes: number }

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
function base64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default function FilesPanel() {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [maxBytes, setMaxBytes] = useState(8 * 1024 * 1024);
  const [chunkBytes, setChunkBytes] = useState(192 * 1024);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const d = (await (await fetch("/api/files", { cache: "no-store" })).json()) as ListResponse;
    setFiles(d.files.sort((a, b) => b.createdAt - a.createdAt));
    setMaxBytes(d.maxBytes);
    setChunkBytes(d.chunkBytes);
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, [refresh]);

  const upload = async (file: globalThis.File) => {
    if (file.size > maxBytes) {
      setLog((l) => [...l, { kind: "err", text: `${file.name}: exceeds ${fmtBytes(maxBytes)} limit` }]);
      return;
    }
    setUploading(true);
    setProgress(0);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const total = Math.max(1, Math.ceil(file.size / chunkBytes));
    setLog((l) => [...l, { kind: "info", text: `OPEN ${file.name} · ${fmtBytes(file.size)} · split into ${total} chunk${total > 1 ? "s" : ""}` }]);
    try {
      for (let i = 0; i < total; i++) {
        const blob = file.slice(i * chunkBytes, Math.min(file.size, (i + 1) * chunkBytes));
        const data = base64(await blob.arrayBuffer());
        const r = await fetch("/api/files", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chunk", uploadId: id, name: file.name, index: i, total, data }),
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error ?? "chunk rejected");
        setProgress(((i + 1) / total) * 100);
        setLog((l) => [...l, { kind: i === total - 1 ? ("ok" as const) : ("dim" as const), text: `chunk ${i + 1}/${total} ACK · cumulative ${fmtBytes(d.received)}${d.file ? ` · sha256 ${d.file.sha256.slice(0, 16)}…` : ""}` }].slice(-90));
      }
      await refresh();
    } catch (e) {
      setLog((l) => [...l, { kind: "err", text: `UPLOAD FAILED: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setUploading(false);
    }
  };

  const sample = () => {
    const lines = Array.from({ length: 120 }, (_, i) => `${new Date(Date.now() + i * 1000).toISOString()} node-${(i % 3) + 1} event=${i} status=${i % 11 === 0 ? "WARN" : "OK"}`);
    void upload(new globalThis.File([lines.join("\n")], "distributed-sample.log", { type: "text/plain" }));
  };

  const remove = async (id: string) => {
    await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    setLog((l) => [...l, { kind: "warn", text: `DELETE file id=${id}` }]);
    refresh();
  };

  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="shared files" value={files.length} sub="visible to every client" />
        <Stat label="stored bytes" value={fmtBytes(totalBytes)} sub="server-side shared folder" />
        <Stat label="chunk size" value={fmtBytes(chunkBytes)} sub="sequential ACKs" />
        <Stat label="integrity" value="SHA-256" tone="ok" sub="verified after assembly" />
        <Stat label="max file" value={fmtBytes(maxBytes)} sub="lab safety limit" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[330px_1fr_340px] gap-5">
        <div className="flex flex-col gap-5">
          <div
            className={`card rivets p-5 flex flex-col items-center justify-center text-center min-h-[250px] cursor-pointer transition-all ${drag ? "hatch" : ""}`}
            style={drag ? { borderColor: "rgba(255,255,255,.65)", boxShadow: "0 0 24px -8px rgba(255,255,255,.5)" } : undefined}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
          >
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }} />
            <span className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.22)" }}>
              <UploadCloud size={22} />
            </span>
            <b className="text-[14px]">Drop a file here</b>
            <span className="mono text-[10px] mt-1" style={{ color: "var(--faint)" }}>or click to browse · max {fmtBytes(maxBytes)}</span>
            {uploading && <div className="w-full mt-5"><div className="bar-track"><div className="bar-fill" style={{ width: `${progress}%` }} /></div><span className="mono tnum text-[10px] mt-1 block">{progress.toFixed(0)}%</span></div>}
          </div>
          <button className="btn justify-center" disabled={uploading} onClick={(e) => { e.stopPropagation(); sample(); }}><FileUp size={12} /> generate sample file</button>
          <div className="field-note">
            <b>Sharing, not local storage:</b> the browser slices a file, sends chunks with sequence numbers, waits for ACKs, and the
            server assembles them into a shared folder. Another browser can list and download it. SHA-256 proves the assembled bytes.
          </div>
        </div>

        <div className="card card-corners p-4 min-w-0">
          <SectionLabel right={<Badge tone="acc">{files.length} objects</Badge>}>Shared folder</SectionLabel>
          <div className="well rounded-lg overflow-hidden min-h-[360px]">
            {files.length === 0 ? (
              <div className="h-[360px] flex flex-col items-center justify-center gap-3" style={{ color: "var(--faint)" }}><FolderOpen size={28} strokeWidth={1.4} /><span className="mono text-[10px]">folder empty · upload from any client</span></div>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
                {files.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3 py-3 hover:bg-white/[.025] transition-colors">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--line)" }}><File size={15} /></span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[12px] font-semibold truncate">{f.name}</span>
                      <span className="mono text-[9px] truncate" style={{ color: "var(--faint)" }}>{fmtBytes(f.size)} · sha256 {f.sha256.slice(0, 20)}…</span>
                      <span className="mono text-[8.5px]" style={{ color: "var(--faint)" }}>{new Date(f.createdAt).toLocaleString()}</span>
                    </div>
                    <a className="btn !p-2" href={`/api/files?download=${encodeURIComponent(f.id)}`} download={f.name} title="download"><Download size={12} /></a>
                    <button className="btn !p-2" onClick={() => remove(f.id)} title="delete"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {files.length > 0 && <div className="flex items-center gap-2 mt-3 mono text-[9.5px]" style={{ color: "var(--dim)" }}><ShieldCheck size={11} /> every digest computed from the final assembled server file</div>}
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="card p-4 flex-1">
            <SectionLabel right={<Badge tone="acc">chunk protocol</Badge>}>Transfer log</SectionLabel>
            <Terminal lines={log} height={450} />
          </div>
          <button className="btn self-start" onClick={() => { setLog([]); setProgress(0); refresh(); }}><RotateCcw size={12} /> clear transfer console</button>
        </div>
      </div>
    </div>
  );
}
