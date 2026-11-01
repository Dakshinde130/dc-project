"use client";

import { useEffect, useState } from "react";
import { Box, Cable, Database, RotateCcw, Search, Send, ServerCog } from "lucide-react";
import { Badge, SectionLabel, Stat, Terminal, type LogLine } from "@/components/ui";

interface Stub { objectId: string; interface: string; methods: string[] }
interface RmiStats {
  pid: number | null;
  stub: Stub | null;
  lookups: number;
  calls: number;
  runtime: string;
}
interface InvokeResult {
  n: number;
  method: string;
  args: (string | number)[];
  value: unknown;
  rttMs: number;
  lookup: boolean;
  ok: boolean;
  callId: number;
  stub: Stub;
  serverPid: number | null;
  executionMs: number | null;
  error?: string;
}

const METHODS = ["add", "multiply", "fibonacci", "describe", "missingMethod"] as const;

export default function RmiPanel() {
  const [stats, setStats] = useState<RmiStats | null>(null);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("add");
  const [a, setA] = useState("21");
  const [b, setB] = useState("21");
  const [last, setLast] = useState<InvokeResult | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => fetch("/api/rmi", { cache: "no-store" }).then((r) => r.json()).then(setStats).catch(() => undefined);
  useEffect(() => { refresh(); const t = setInterval(refresh, 1200); return () => clearInterval(t); }, []);

  const lookup = async (force = false) => {
    setBusy(true);
    const r = await fetch("/api/rmi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lookup", forceLookup: force }) });
    const d = await r.json();
    setLog((l) => [...l, { kind: "info" as const, text: `Registry.lookup("CalculatorService") → RemoteRef(${d.stub?.objectId}) · ${d.cached ? "cached stub" : "network lookup"}` }].slice(-80));
    await refresh();
    setBusy(false);
  };

  const invoke = async () => {
    setBusy(true);
    const args: number[] = method === "add" || method === "multiply" ? [Number(a), Number(b)] : method === "fibonacci" ? [Number(a)] : [];
    const r = await fetch("/api/rmi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "invoke", method, args }) });
    const d = (await r.json()) as InvokeResult;
    setLast(d);
    setLog((l) => [...l, {
      kind: d.ok ? ("ok" as const) : ("err" as const),
      text: d.ok
        ? `stub.${method}(${args.join(", ")}) → ${String(d.value)} · callId=${d.callId} · ${d.rttMs}ms${d.lookup ? " · registry lookup first" : " · cached stub"}`
        : `${method}: ${d.error ?? String(d.value)}`,
    }].slice(-80));
    await refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="card rivets px-5 py-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="registry lookups" value={stats?.lookups ?? 0} sub={stats?.stub ? "stub cached" : "not bound locally"} />
        <Stat label="remote calls" value={stats?.calls ?? 0} sub="through remote reference" />
        <Stat label="last value" value={<span className="text-[13px] truncate max-w-[170px] inline-block">{last ? String(last.value) : "—"}</span>} tone={last?.ok ? "ok" : last ? "warn" : undefined} />
        <Stat label="last rtt" value={last ? `${last.rttMs}ms` : "—"} sub={last?.executionMs != null ? `${last.executionMs}ms server execution` : ""} />
        <Stat label="remote object pid" value={last?.serverPid ?? stats?.pid ?? "booting…"} sub="registry tcp :5401" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_330px] gap-5">
        <div className="flex flex-col gap-5">
          <div className="card rivets p-4 flex flex-col gap-4">
            <SectionLabel>Client</SectionLabel>
            <button className="btn justify-center" disabled={busy} onClick={() => lookup(true)}><Search size={12} /> registry.lookup()</button>
            <div className="seg self-start">
              {METHODS.map((m) => <button key={m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>{m}</button>)}
            </div>
            {(method === "add" || method === "multiply") && (
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={a} onChange={(e) => setA(e.target.value)} className="well rounded-lg px-3 py-2 mono text-[12px] outline-none w-full" />
                <input type="number" value={b} onChange={(e) => setB(e.target.value)} className="well rounded-lg px-3 py-2 mono text-[12px] outline-none w-full" />
              </div>
            )}
            {method === "fibonacci" && <input type="number" value={a} onChange={(e) => setA(e.target.value)} className="well rounded-lg px-3 py-2 mono text-[12px] outline-none w-full" />}
            <button className="btn btn-acc justify-center" disabled={busy} onClick={invoke}><Send size={12} /> invoke remote method</button>
            <button className="btn self-start" onClick={async () => { await fetch("/api/rmi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) }); setLast(null); setLog([]); refresh(); }}><RotateCcw size={12} /> discard stub</button>
          </div>
          <div className="field-note">
            <b>Java RMI lifecycle:</b> registry lookup returns a serialized remote reference. The client casts it to the remote interface;
            calling the stub marshals arguments, crosses the transport, dispatches on the exported object, and unmarshals the return value.
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="card card-corners p-4">
            <SectionLabel right={<Badge tone="acc">registry → stub → object</Badge>}>Remote-object graph</SectionLabel>
            <div className="flex flex-col md:flex-row items-stretch gap-2 mono text-[10px] text-center">
              <Node icon={<Box size={16} />} title="CLIENT" sub="Client.java" active />
              <Arrow label="lookup" />
              <Node icon={<Database size={16} />} title="REGISTRY" sub="CalculatorService" active={!!stats?.stub} />
              <Arrow label="RemoteRef" />
              <Node icon={<Cable size={16} />} title="STUB" sub={stats?.stub?.objectId ?? "not cached"} active={!!stats?.stub} />
              <Arrow label="invoke" />
              <Node icon={<ServerCog size={16} />} title="REMOTE OBJECT" sub={`pid ${stats?.pid ?? "—"}`} active={!!last?.ok} />
            </div>
            {stats?.stub && (
              <div className="well rounded-lg p-3 mt-4 mono text-[10px]">
                <div style={{ color: "var(--faint)" }}>serialized remote reference</div>
                <div className="mt-1">objectId <b className="text-white">{stats.stub.objectId}</b> · interface <b className="text-white">{stats.stub.interface}</b></div>
                <div className="mt-1" style={{ color: "var(--dim)" }}>{stats.stub.methods.join(" · ")}</div>
              </div>
            )}
          </div>

          <div className="card p-4">
            <SectionLabel>Canonical Java source · included in /java/rmi-lab</SectionLabel>
            <pre className="well rounded-lg p-3 mono text-[10px] leading-relaxed overflow-auto" style={{ color: "var(--dim)", maxHeight: 260 }}>{`public interface Calculator extends Remote {
  double add(double a, double b) throws RemoteException;
  long fibonacci(int n) throws RemoteException;
}

Registry registry = LocateRegistry.getRegistry("127.0.0.1", 1099);
Calculator stub = (Calculator) registry.lookup("CalculatorService");
double answer = stub.add(21, 21); // remote invocation`}</pre>
            <p className="mono mt-2 text-[9px] leading-relaxed" style={{ color: "var(--faint)" }}>
              This sandbox has no JVM. The live :5401 process executes the same registry/stub/remote-reference protocol over TCP;
              the included Java files use java.rmi directly and run unchanged on a JDK.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="card p-4 flex-1">
            <SectionLabel right={<Badge tone="acc">{stats?.calls ?? 0} calls</Badge>}>Invocation log</SectionLabel>
            <Terminal lines={log} height={440} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Node({ icon, title, sub, active }: { icon: React.ReactNode; title: string; sub: string; active: boolean }) {
  return <div className="card flex-1 p-3 flex flex-col items-center gap-1" style={active ? { borderColor: "rgba(255,255,255,.45)", boxShadow: "0 0 16px -8px rgba(255,255,255,.5)" } : undefined}><span style={{ color: active ? "#fff" : "var(--faint)" }}>{icon}</span><b>{title}</b><span style={{ color: "var(--faint)" }}>{sub}</span></div>;
}
function Arrow({ label }: { label: string }) {
  return <div className="flex md:flex-col items-center justify-center gap-1" style={{ color: "var(--faint)" }}><span>→</span><span className="text-[8px]">{label}</span></div>;
}
