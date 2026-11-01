/** Live clients/process managers for XML-RPC and the RMI protocol runtime. */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { getGlobal } from "./store";
import { prekill } from "./backends";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

class ManagedSatellite {
  child: ChildProcess | null = null;
  starting: Promise<void> | null = null;

  constructor(
    private readonly script: string,
    private readonly args: string[],
    private readonly readyText: string,
    private readonly killPattern: string
  ) {}

  ensure(): Promise<void> {
    if (!this.starting) {
      this.starting = (async () => {
        await prekill(this.killPattern);
        await sleep(120);
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", this.script), ...this.args], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          this.child = child;
          const timer = setTimeout(() => reject(new Error(`${this.script} start timeout`)), 6000);
          child.stdout?.on("data", (d) => {
            const s = String(d);
            process.stdout.write(`[${this.script}] ${s.trim()}\n`);
            if (s.includes(this.readyText)) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.stderr?.on("data", (d) => process.stderr.write(`[${this.script}] ${String(d).trim()}\n`));
          child.on("exit", () => {
            this.child = null;
            this.starting = null;
          });
        });
      })();
    }
    return this.starting;
  }
}

const xmlSatellite = new ManagedSatellite("xmlrpc-server.js", ["--port", "5301"], "XMLRPC-READY", "xmlrpc-server.js --port 5301");
const rmiSatellite = new ManagedSatellite("rmi-server.js", ["--port", "5401"], "RMI-READY", "rmi-server.js --port 5401");

function xmlEscape(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function encodeXmlValue(v: string | number | boolean) {
  if (typeof v === "number" && Number.isInteger(v)) return `<value><int>${v}</int></value>`;
  if (typeof v === "number") return `<value><double>${v}</double></value>`;
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  return `<value><string>${xmlEscape(v)}</string></value>`;
}
function decodeXmlResponse(xml: string): { ok: boolean; value?: string | number | boolean; fault?: string } {
  const fault = xml.match(/<fault>[\s\S]*?<name>faultString<\/name>[\s\S]*?<string>([\s\S]*?)<\/string>/i);
  if (fault) return { ok: false, fault: fault[1] };
  const int = xml.match(/<(?:int|i4)>([+-]?\d+)<\/(?:int|i4)>/i);
  if (int) return { ok: true, value: Number(int[1]) };
  const dbl = xml.match(/<double>([+-]?[\d.]+)<\/double>/i);
  if (dbl) return { ok: true, value: Number(dbl[1]) };
  const bool = xml.match(/<boolean>([01])<\/boolean>/i);
  if (bool) return { ok: true, value: bool[1] === "1" };
  const str = xml.match(/<string>([\s\S]*?)<\/string>/i);
  return { ok: true, value: str?.[1] ?? "" };
}

class XmlRpcLab {
  calls = 0;
  faults = 0;
  bytesTx = 0;
  bytesRx = 0;
  history: { n: number; method: string; result: string; rttMs: number; bytes: number; ok: boolean }[] = [];

  async call(method: string, params: (string | number | boolean)[]) {
    await xmlSatellite.ensure();
    const xml = `<?xml version="1.0"?><methodCall><methodName>${xmlEscape(method)}</methodName><params>${params
      .map((p) => `<param>${encodeXmlValue(p)}</param>`)
      .join("")}</params></methodCall>`;
    const t0 = performance.now();
    const res = await fetch("http://127.0.0.1:5301/RPC2", {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xml,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const responseXml = await res.text();
    const parsed = decodeXmlResponse(responseXml);
    const rttMs = Math.max(0.1, Math.round((performance.now() - t0) * 100) / 100);
    this.calls++;
    if (!parsed.ok) this.faults++;
    this.bytesTx += Buffer.byteLength(xml);
    this.bytesRx += Buffer.byteLength(responseXml);
    const item = {
      n: this.calls,
      method,
      result: String(parsed.ok ? parsed.value : parsed.fault),
      rttMs,
      bytes: Buffer.byteLength(xml) + Buffer.byteLength(responseXml),
      ok: parsed.ok,
    };
    this.history.push(item);
    if (this.history.length > 60) this.history.shift();
    return { ...item, requestXml: xml, responseXml, serverPid: xmlSatellite.child?.pid ?? null };
  }

  stats() {
    return { pid: xmlSatellite.child?.pid ?? null, calls: this.calls, faults: this.faults, bytesTx: this.bytesTx, bytesRx: this.bytesRx, history: this.history };
  }
}

interface RemoteRef {
  objectId: string;
  interface: string;
  methods: string[];
}

function tcpMessage(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(5401, "127.0.0.1");
    let buf = "";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("RMI transport timeout"));
    }, 5000);
    sock.on("connect", () => sock.write(JSON.stringify(message) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        clearTimeout(timer);
        sock.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

class RmiLab {
  stub: RemoteRef | null = null;
  lookups = 0;
  calls = 0;
  callSeq = 0;
  history: { n: number; method: string; args: (string | number)[]; value: unknown; rttMs: number; lookup: boolean; ok: boolean }[] = [];

  async lookup(force = false) {
    await rmiSatellite.ensure();
    if (this.stub && !force) return { stub: this.stub, cached: true, serverPid: rmiSatellite.child?.pid ?? null };
    const r = await tcpMessage({ op: "lookup", name: "CalculatorService" });
    if (!r.ok) throw new Error(String(r.error));
    this.stub = r.remoteRef as unknown as RemoteRef;
    this.lookups++;
    return { stub: this.stub, cached: false, serverPid: r.serverPid };
  }

  async invoke(method: string, args: (string | number)[], forceLookup = false) {
    const lookup = await this.lookup(forceLookup);
    const callId = ++this.callSeq;
    const t0 = performance.now();
    const r = await tcpMessage({ op: "invoke", objectId: this.stub!.objectId, method, args, callId });
    const rttMs = Math.max(0.1, Math.round((performance.now() - t0) * 100) / 100);
    this.calls++;
    const item = { n: this.calls, method, args, value: r.ok ? r.value : r.error, rttMs, lookup: !lookup.cached, ok: !!r.ok };
    this.history.push(item);
    if (this.history.length > 60) this.history.shift();
    return { ...item, callId, stub: this.stub, serverPid: r.serverPid ?? rmiSatellite.child?.pid ?? null, executionMs: r.executionMs ?? null };
  }

  reset() {
    this.stub = null;
    this.lookups = 0;
    this.calls = 0;
    this.history = [];
  }

  stats() {
    return { pid: rmiSatellite.child?.pid ?? null, stub: this.stub, lookups: this.lookups, calls: this.calls, history: this.history, runtime: "RMI protocol runtime (canonical Java source included; JVM unavailable in sandbox)" };
  }
}

export function getXmlRpcLab(): XmlRpcLab {
  return getGlobal("dslab.xmlrpc", () => new XmlRpcLab());
}
export function getRmiLab(): RmiLab {
  return getGlobal("dslab.rmi", () => new RmiLab());
}
