"use client";

import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { ArrowRightLeft, Box, Braces, Clock, Combine, File, OctagonX, Radar, RadioTower, RefreshCw, Share2 } from "lucide-react";
import OverviewPanel from "@/components/panels/overview";
import TcpPanel from "@/components/panels/tcp";
import UdpPanel from "@/components/panels/udp";
import XmlRpcPanel from "@/components/panels/xmlrpc";
import RmiPanel from "@/components/panels/rmi";
import FilesPanel from "@/components/panels/files";
import RoundRobinPanel from "@/components/panels/roundrobin";
import BerkeleyPanel from "@/components/panels/berkeley";
import RicartPanel from "@/components/panels/ricart";
import MapReducePanel from "@/components/panels/mapreduce";
import DeadlockPanel from "@/components/panels/deadlock";

interface Concept {
  id: string;
  num: string;
  title: string;
  tagline: string;
  icon: ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
  Panel: ComponentType;
}

const CONCEPTS: Concept[] = [
  { id: "overview", num: "00", title: "Overview", tagline: "All ten protocols and algorithms", icon: Radar, Panel: OverviewPanel },
  { id: "tcp", num: "01", title: "TCP Messaging", tagline: "real sockets · handshake vs. persistent pooling", icon: ArrowRightLeft, Panel: TcpPanel },
  { id: "udp", num: "02", title: "UDP Notifications", tagline: "fire-and-forget datagrams · loss made visible", icon: RadioTower, Panel: UdpPanel },
  { id: "xmlrpc", num: "03", title: "XML-RPC", tagline: "typed method calls serialized as XML over HTTP", icon: Braces, Panel: XmlRpcPanel },
  { id: "rmi", num: "04", title: "Java RMI", tagline: "registry → stub → remote object invocation", icon: Box, Panel: RmiPanel },
  { id: "files", num: "05", title: "File Sharing", tagline: "chunk upload, shared folder, SHA-256 integrity", icon: File, Panel: FilesPanel },
  { id: "roundrobin", num: "06", title: "Round Robin", tagline: "strict cursor routing across three real workers", icon: RefreshCw, Panel: RoundRobinPanel },
  { id: "berkeley", num: "07", title: "Berkeley Sync", tagline: "drifting process clocks, converged by a coordinator", icon: Clock, Panel: BerkeleyPanel },
  { id: "ricart", num: "08", title: "Ricart–Agrawala", tagline: "mutual exclusion with no central lock", icon: Share2, Panel: RicartPanel },
  { id: "deadlock", num: "09", title: "Deadlock Detection", tagline: "wait-for graph, cycle detection, victim preemption", icon: OctagonX, Panel: DeadlockPanel },
  { id: "mapreduce", num: "10", title: "MapReduce", tagline: "split → map on real workers → shuffle → reduce", icon: Combine, Panel: MapReducePanel },
];

const ACCENT = "#eceff1";

function Clock_() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="mono tnum text-[11px]" style={{ color: "var(--faint)" }}>
      {now || "··:··:··"}
    </span>
  );
}

export default function LabShell() {
  const [activeId, setActiveId] = useState("tcp");
  const active = CONCEPTS.find((c) => c.id === activeId) ?? CONCEPTS[1];

  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (CONCEPTS.some((c) => c.id === h)) setActiveId(h);
  }, []);
  useEffect(() => {
    history.replaceState(null, "", `#${activeId}`);
  }, [activeId]);

  return (
    <div
      className="min-h-screen lg:flex"
      style={{ "--accent": ACCENT, "--accent-soft": "rgba(255,255,255,.08)" } as CSSProperties}
    >
      {/* ------------------------- sidebar (desktop) ------------------------- */}
      <aside
        className="brushed hidden lg:flex w-[248px] flex-none flex-col border-r min-h-screen sticky top-0 h-screen"
        style={{
          borderColor: "var(--line-soft)",
          backgroundColor: "rgba(7,8,10,.82)",
          backdropFilter: "blur(10px)",
          boxShadow: "inset -1px 0 0 rgba(255,255,255,.03), 8px 0 28px -20px rgba(0,0,0,.9)",
        }}
      >
        <div className="px-5 pt-6 pb-5 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center gap-2.5">
            <span className="led acc" />
            <span className="mono text-[10px] tracking-[0.28em]" style={{ color: "var(--dim)" }}>
              DIST·SYS·LAB
            </span>
          </div>
          <h1 className="mt-3 text-[19px] leading-tight font-bold tracking-tight">
            Distributed
            <br />
            Systems Lab
          </h1>
          <p className="mono mt-2 text-[10px] leading-relaxed" style={{ color: "var(--faint)" }}>
            a teaching lab where the algorithms actually run
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          {CONCEPTS.map((c) => {
            const Icon = c.icon;
            const on = c.id === activeId;
            return (
              <button key={c.id} className={`navbtn ${on ? "on" : ""}`} onClick={() => setActiveId(c.id)}>
                <span className="mono text-[9px] w-5 flex-none" style={{ color: on ? "#fff" : "var(--faint)" }}>
                  {c.num}
                </span>
                <Icon size={15} strokeWidth={1.8} className="flex-none" />
                <span className="text-[13px] font-medium tracking-tight">{c.title}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t mono text-[9.5px] leading-relaxed" style={{ borderColor: "var(--line-soft)", color: "var(--faint)" }}>
          <div className="flex items-center gap-2">
            <span className="led on" />
            <span>control :3000</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="led acc" />
            <span>workers :4101–4103</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="led" />
            <span>tcp :5101 · udp :5201/5202</span>
          </div>
        </div>
      </aside>

      {/* -------------------------------- main -------------------------------- */}
      <main className="flex-1 min-w-0">
        <div className="sticky top-0 z-30">
          <header
            className="flex items-center justify-between gap-3 px-4 md:px-7 h-[56px] border-b"
            style={{
              borderColor: "var(--line-soft)",
              background: "rgba(8,9,11,.82)",
              backdropFilter: "blur(12px)",
              boxShadow: "0 12px 28px -18px rgba(0,0,0,.9), inset 0 -1px 0 rgba(255,255,255,.03)",
            }}
          >
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <span className="led acc lg:hidden" />
              <span className="mono text-[10px] tracking-[0.22em] flex-none" style={{ color: "#eceff1" }}>
                {active.num}
              </span>
              <h2 className="text-[14px] md:text-[15px] font-semibold tracking-tight truncate">{active.title}</h2>
              <span className="mono text-[10.5px] truncate hidden xl:inline" style={{ color: "var(--faint)" }}>
                {active.tagline}
              </span>
            </div>
            <div className="flex items-center gap-3 md:gap-4 flex-none">
              <Clock_ />
              <span className="chip hidden sm:inline-flex">
                <span className="led on" />
                LIVE PROCESSES
              </span>
            </div>
          </header>

          {/* mobile/tablet module rail */}
          <nav
            className="mnav lg:hidden flex gap-2 overflow-x-auto px-4 md:px-7 py-2.5 border-b"
            style={{ borderColor: "var(--line-soft)", background: "rgba(8,9,11,.75)", backdropFilter: "blur(12px)" }}
          >
            {CONCEPTS.map((c) => {
              const Icon = c.icon;
              const on = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`navbtn ${on ? "on" : ""}`}
                  style={{ width: "auto", flex: "none", padding: "7px 11px", gap: 7 } as CSSProperties}
                >
                  <Icon size={13} strokeWidth={1.9} />
                  <span className="text-[12px] font-medium whitespace-nowrap">{c.title}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div key={activeId} className="panel-enter px-4 md:px-7 py-5 md:py-6 max-w-[1440px] mx-auto">
          <active.Panel />
        </div>
      </main>
    </div>
  );
}
