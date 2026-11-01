"use client";

import { useEffect, useState } from "react";
import { Braces, Code2, RotateCcw, Send, ServerCog } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, type LogLine } from "@/components/ui";

interface RpcResult {
  n: number;
  method: string;
  result: string;
  rttMs: number;
  bytes: number;
  ok: boolean;
  requestXml: string;
  responseXml: string;
  serverPid: number | null;
  fault?: string;
}
interface RpcStats {
  pid: number | null;
  calls: number;
  faults: number;
  bytesTx: number;
  bytesRx: number;
  history: { n: number; method: string; result: string; rttMs: number; bytes: number; ok: boolean }[];
}

const METHODS = [
  { id: "math.add", label: "math.add", type: "numbers" },
  { id: "math.multiply", label: "math.multiply", type: "numbers" },
  { id: "system.echo", label: "system.echo", type: "text" },
  { id: "stats.summary", label: "stats.summary", type: "none" },
  { id: "unknown.method", label: "unknown.method → fault", type: "none" },
] as const;

function prettyXml(xml: string) {
  return xml.replace(/></g, ">\n<");
}

export default function XmlRpcPanel() {
  const [method, setMethod] = useState<(typeof METHODS)[number]>(METHODS[0]);
  const [a, setA] = useState("21");
  const [b, setB] = useState("21");
  const [text, setText] = useState("hello from an XML document");
  const [stats, setStats] = useState<RpcStats | null>(null);
  const [last, setLast] = useState<RpcResult | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tick = () => fetch("/api/xmlrpc", { cache: "no-store" }).then((r) => r.json()).then(setStats).catch(() => undefined);
    tick();
    const t = setInterval(tick, 1200);
    return () => clearInterval(t);
  }, []);

  const call = async () => {
    setBusy(true);
    const params: (string | number)[] = method.type === "numbers" ? [Number(a), Number(b)] : method.type === "text" ? [text] : [];
    const r = await fetch("/api/xmlrpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: method.id, params }),
    });
    const d = (await r.json()) as RpcResult;
    setLast(d);
    setLog((l) => [
      ...l,
      { kind: d.ok ? ("ok" as const) : ("err" as const), text: `#${d.n ?? "—"} ${method.id}(${params.join(", ")}) → ${d.ok ? d.result : d.fault ?? d.result} · ${d.rttMs ?? 0}ms · ${d.bytes ?? 0} bytes` },
    ].slice(-80));
    setStats((s) => s ? { ...s, calls: s.calls + 1, faults: s.faults + (d.ok ? 0 : 1) } : s);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="method calls" value={stats?.calls ?? 0} sub={`${stats?.faults ?? 0} faults`} />
        <Stat label="last result" value={<span className="text-[13px] truncate max-w-[150px] inline-block">{last?.result ?? "—"}</span>} tone={last?.ok ? "ok" : last ? "warn" : undefined} />
        <Stat label="last rtt" value={last ? `${last.rttMs}ms` : "—"} sub="HTTP request + XML parse" />
        <Stat label="wire bytes" value={(stats?.bytesTx ?? 0) + (stats?.bytesRx ?? 0)} sub={`${stats?.bytesTx ?? 0} tx · ${stats?.bytesRx ?? 0} rx`} />
        <Stat label="server process" value={last?.serverPid ?? stats?.pid ?? "booting…"} sub="http://127.0.0.1:5301/RPC2" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_330px] gap-5">
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Method call</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  className={`navbtn ${method.id === m.id ? "on" : ""}`}
                  onClick={() => setMethod(m)}
                >
                  <Code2 size={13} />
                  <span className="mono text-[11px]">{m.label}</span>
                </button>
              ))}
            </div>
            {method.type === "numbers" && (
              <div className="grid grid-cols-2 gap-2">
                {[a, b].map((v, i) => (
                  <input key={i} type="number" value={v} onChange={(e) => (i === 0 ? setA(e.target.value) : setB(e.target.value))} className="well rounded-lg px-3 py-2 mono text-[12px] outline-none w-full" />
                ))}
              </div>
            )}
            {method.type === "text" && <input value={text} onChange={(e) => setText(e.target.value)} className="well rounded-lg px-3 py-2 mono text-[12px] outline-none w-full" />}
            <button className="btn btn-acc justify-center" disabled={busy} onClick={call}>
              <Send size={12} /> serialize + call
            </button>
            <button className="btn self-start" onClick={() => { setLast(null); setLog([]); }}><RotateCcw size={12} /> clear console</button>
          </div>
          <div className="field-note">
            <b>XML-RPC:</b> one method name plus typed values, serialized as XML and sent over HTTP. It is verbose but language-neutral.
            Trigger <span className="mono">unknown.method</span> to see a standards-style fault response instead of an HTTP error.
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <XmlWell title="request · text/xml" xml={last?.requestXml ?? "<!-- make a call to inspect the request document -->"} />
            <XmlWell title="response · text/xml" xml={last?.responseXml ?? "<!-- the response document returns here -->"} fault={last ? !last.ok : false} />
          </div>
          <div className="card p-4">
            <SectionLabel right={<Badge tone="acc">XML over HTTP</Badge>}>Call path</SectionLabel>
            <div className="flex flex-col sm:flex-row items-center gap-2 mono text-[10px] text-center">
              {[
                ["CLIENT", "typed values"],
                ["MARSHAL", "XML document"],
                ["POST /RPC2", "Content-Type: text/xml"],
                ["DISPATCH", method.id],
                ["UNMARSHAL", "typed result"],
              ].map(([x, y], i) => (
                <div key={x} className="contents">
                  <div className="card px-3 py-2 flex-1 w-full"><b>{x}</b><br /><span style={{ color: "var(--faint)" }}>{y}</span></div>
                  {i < 4 && <span style={{ color: "var(--faint)" }}>→</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="card p-4 flex-1">
            <SectionLabel right={<ServerCog size={11} style={{ color: "var(--faint)" }} />}>Call log</SectionLabel>
            <Terminal lines={log} height={430} />
          </div>
          <div className="card p-4">
            <SectionLabel><span className="flex items-center gap-1.5"><Braces size={10} /> supported types</span></SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {["<int>", "<double>", "<string>", "<boolean>", "<fault>"].map((x) => <span key={x} className="chip">{x}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function XmlWell({ title, xml, fault }: { title: string; xml: string; fault?: boolean }) {
  return (
    <div className={`card p-4 ${fault ? "hatch" : ""}`}>
      <SectionLabel>{title}</SectionLabel>
      <pre className="well rounded-lg p-3 mono text-[9.5px] leading-relaxed overflow-auto whitespace-pre-wrap break-all" style={{ height: 300, color: fault ? "#fff" : "var(--dim)" }}>
        {prettyXml(xml)}
      </pre>
    </div>
  );
}
