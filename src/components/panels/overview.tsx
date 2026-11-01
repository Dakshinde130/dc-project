"use client";

import {
  ArrowRight,
  ArrowRightLeft,
  Box,
  Braces,
  Clock,
  Combine,
  File,
  OctagonX,
  RadioTower,
  RefreshCw,
  Server,
  Share2,
  TerminalSquare,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { SectionLabel } from "@/components/ui";

const CARDS: { icon: LucideIcon; num: string; title: string; body: string; how: string }[] = [
  { icon: ArrowRightLeft, num: "01", title: "TCP Messaging", body: "Fresh handshakes versus a persistent pooled socket, with real RTT and connection counters.", how: "node:net broker · tcp :5101" },
  { icon: RadioTower, num: "02", title: "UDP Notifications", body: "Sequence-numbered datagrams make packet loss visible with no ACK or retransmit.", how: "node:dgram · :5201 ⇄ :5202" },
  { icon: Braces, num: "03", title: "XML-RPC", body: "Typed calls marshal into XML, cross HTTP, dispatch by method name, and return XML values or faults.", how: "real XML server · POST /RPC2 :5301" },
  { icon: Box, num: "04", title: "Java RMI", body: "Registry lookup returns a remote reference; the cached stub marshals remote method invocations.", how: "RMI protocol runtime :5401 · Java source included" },
  { icon: File, num: "05", title: "File Sharing", body: "Drag a file, stream numbered chunks, assemble on the server, verify SHA-256, download from another client.", how: "chunk ACKs · shared server folder" },
  { icon: RefreshCw, num: "06", title: "Round Robin", body: "A strict cursor cycles across three real workers; equal counts survive even when one worker is slow.", how: "cursor mod 3 · BE-4101/4102/4103" },
  { icon: Clock, num: "07", title: "Berkeley Sync", body: "Three independently drifting process clocks converge around a coordinator-computed mean.", how: "real per-process clocks · offset + ppm drift" },
  { icon: Share2, num: "08", title: "Ricart–Agrawala", body: "Decentralized mutual exclusion using REQUEST, REPLY, deferred queues, and Lamport timestamps.", how: "3 async actors · no lock server" },
  { icon: OctagonX, num: "09", title: "Deadlock Detection", body: "Opposite lock ordering creates a wait-for cycle; DFS detects it and victim preemption recovers.", how: "resource manager · live graph" },
  { icon: Combine, num: "10", title: "MapReduce", body: "Chunks map on three worker processes, shuffle by key, and reduce into a live word-count output.", how: "real mapper RPCs · SSE job tracker" },
];

export default function OverviewPanel() {
  return (
    <div className="flex flex-col gap-6">
      <div className="card card-corners p-6">
        <SectionLabel>Abstract</SectionLabel>
        <p className="text-[14.5px] leading-relaxed max-w-5xl" style={{ color: "var(--dim)" }}>
          <b className="text-white font-semibold">Ten distributed-systems concepts, all interactive.</b>{" "}
          The lab mixes real OS processes, TCP and UDP sockets, XML documents, remote references, chunked files, drifting clocks,
          asynchronous actors, resource graphs, and distributed mapper workers. The monochrome dashboard is an observer and control
          surface—the protocols execute on the server.
        </p>
      </div>

      <div className="card p-6">
        <SectionLabel>Live topology</SectionLabel>
        <div className="flex flex-col lg:flex-row items-stretch gap-4">
          <ArchNode icon={<TerminalSquare size={16} />} title="Browser console" sub="controls · SSE traces · visualizations" />
          <ArchArrow label="fetch · sse" />
          <ArchNode icon={<Workflow size={16} />} title="Control plane :3000" sub="coordinators · clients · state engines" bright />
          <ArchArrow label="tcp · udp · http" />
          <div className="flex-[1.35] grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              ["BE-4101 / 4102 / 4103", "workers · clocks · maps · RR"],
              ["TCP-BROKER :5101", "MSG / ACK framing"],
              ["UDP-NOTIFIER :5201/5202", "datagrams + config"],
              ["XML-RPC :5301/RPC2", "typed XML method calls"],
              ["RMI REGISTRY :5401", "lookup · stub · invoke"],
              ["SHARED FOLDER", "chunks · SHA-256 · downloads"],
            ].map(([name, sub]) => (
              <div key={name} className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5" style={{ borderColor: "var(--line)", background: "rgba(255,255,255,.025)" }}>
                <Server size={14} style={{ color: "#eceff1" }} />
                <div className="flex flex-col min-w-0">
                  <span className="mono text-[10.5px] font-semibold truncate">{name}</span>
                  <span className="mono text-[9px] truncate" style={{ color: "var(--faint)" }}>{sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {CARDS.map((c) => (
          <div key={c.num} className="card p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center border" style={{ background: "rgba(255,255,255,.05)", borderColor: "rgba(255,255,255,.18)", color: "#eceff1" }}>
                <c.icon size={16} strokeWidth={1.8} />
              </span>
              <div>
                <div className="mono text-[9px] tracking-[0.25em]" style={{ color: "var(--faint)" }}>MODULE {c.num}</div>
                <h3 className="text-[15px] font-semibold tracking-tight">{c.title}</h3>
              </div>
            </div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>{c.body}</p>
            <div className="mono mt-3 text-[10px] tracking-wide text-white">{c.how}</div>
          </div>
        ))}
      </div>

      <div className="field-note">
        <b>Recommended route:</b> compare TCP and UDP first; inspect XML-RPC and RMI as two generations of RPC; upload a file;
        degrade the Round Robin pool; sabotage Berkeley clocks; then finish with Ricart–Agrawala, Deadlock, and MapReduce.
      </div>
    </div>
  );
}

function ArchNode({ icon, title, sub, bright }: { icon: React.ReactNode; title: string; sub: string; bright?: boolean }) {
  return <div className="flex-1 rounded-xl border p-4 flex flex-col justify-center" style={{ borderColor: "var(--line)", background: "rgba(255,255,255,.02)" }}><div className="flex items-center gap-2.5"><span style={{ color: bright ? "#fff" : "#eceff1" }}>{icon}</span><span className="text-[13px] font-semibold">{title}</span></div><span className="mono mt-1.5 text-[10px]" style={{ color: "var(--faint)" }}>{sub}</span></div>;
}
function ArchArrow({ label }: { label: string }) {
  return <div className="flex lg:flex-col items-center justify-center gap-1.5 flex-none px-1" style={{ color: "var(--faint)" }}><span className="mono text-[9px] tracking-[0.15em] uppercase">{label}</span><ArrowRight size={14} className="rotate-90 lg:rotate-0" /></div>;
}
