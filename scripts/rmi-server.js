#!/usr/bin/env node
/**
 * RMI protocol runtime for environments without a JVM.
 * Implements Java RMI's registry → remote reference → invocation flow over
 * a real TCP connection. Canonical Java source is in java/rmi-lab/.
 *
 * Newline-delimited JSON protocol on :5401:
 *   {op:"lookup", name:"CalculatorService"}
 *   {op:"invoke", objectId:"calc-1", method:"add", args:[2,3], callId:1}
 */
"use strict";

const net = require("net");
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1] || 5401);
let calls = 0;
let lookups = 0;
let active = 0;

const registry = {
  CalculatorService: {
    objectId: "calc-1",
    interface: "Calculator",
    methods: ["add", "multiply", "fibonacci", "describe"],
  },
};
const objects = {
  "calc-1": {
    add: (a, b) => Number(a) + Number(b),
    multiply: (a, b) => Number(a) * Number(b),
    fibonacci: (n) => {
      n = Math.max(0, Math.min(42, Number(n) | 0));
      let a = 0, b = 1;
      for (let i = 0; i < n; i++) [a, b] = [b, a + b];
      return a;
    },
    describe: () => `CalculatorImpl pid=${process.pid} tcp=${PORT}`,
  },
};

function send(sock, obj) {
  sock.write(JSON.stringify(obj) + "\n");
}

const server = net.createServer((sock) => {
  active++;
  let buffer = "";
  sock.on("data", (d) => {
    buffer += d.toString("utf8");
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const t0 = performance.now();
      try {
        const m = JSON.parse(line);
        if (m.op === "lookup") {
          lookups++;
          const ref = registry[m.name];
          send(sock, ref ? { ok: true, op: "lookup", name: m.name, remoteRef: ref, serverPid: process.pid } : { ok: false, error: "NotBoundException" });
        } else if (m.op === "invoke") {
          calls++;
          const object = objects[m.objectId];
          const fn = object?.[m.method];
          if (!fn) send(sock, { ok: false, callId: m.callId, error: "RemoteException: method not found" });
          else {
            const value = fn(...(Array.isArray(m.args) ? m.args : []));
            send(sock, { ok: true, callId: m.callId, value, serverPid: process.pid, executionMs: Math.max(0.01, Math.round((performance.now() - t0) * 100) / 100) });
          }
        } else if (m.op === "stats") {
          send(sock, { ok: true, pid: process.pid, port: PORT, calls, lookups, active });
        } else send(sock, { ok: false, error: "RemoteException: unknown operation" });
      } catch (e) {
        send(sock, { ok: false, error: `RemoteException: ${e.message || e}` });
      }
    }
  });
  sock.on("error", () => undefined);
  sock.on("close", () => (active = Math.max(0, active - 1)));
});

server.on("error", (e) => {
  console.error(`RMI-BIND-ERROR ${e.code || e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => console.log(`RMI-READY registry=127.0.0.1:${PORT} pid=${process.pid}`));
process.on("SIGTERM", () => process.exit(0));
