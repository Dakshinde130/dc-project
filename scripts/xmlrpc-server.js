#!/usr/bin/env node
/**
 * Minimal, real XML-RPC server. Zero dependencies.
 * POST text/xml to http://127.0.0.1:5301/RPC2
 * Methods: math.add, math.multiply, system.echo, stats.summary
 */
"use strict";

const http = require("http");
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1] || 5301);
let calls = 0;
let faults = 0;
const startedAt = Date.now();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseValue(xml) {
  const int = xml.match(/<(?:int|i4)>([+-]?\d+)<\/(?:int|i4)>/i);
  if (int) return Number(int[1]);
  const dbl = xml.match(/<double>([+-]?[\d.]+)<\/double>/i);
  if (dbl) return Number(dbl[1]);
  const bool = xml.match(/<boolean>([01])<\/boolean>/i);
  if (bool) return bool[1] === "1";
  const str = xml.match(/<string>([\s\S]*?)<\/string>/i);
  if (str) return unesc(str[1]);
  const raw = xml.match(/<value>([^<]*)<\/value>/i);
  return raw ? unesc(raw[1]) : null;
}

function parseCall(xml) {
  const method = unesc(xml.match(/<methodName>([\s\S]*?)<\/methodName>/i)?.[1] || "");
  const params = [...xml.matchAll(/<param>([\s\S]*?)<\/param>/gi)].map((m) => parseValue(m[1]));
  return { method, params };
}

function encodeValue(v) {
  if (typeof v === "number" && Number.isInteger(v)) return `<value><int>${v}</int></value>`;
  if (typeof v === "number") return `<value><double>${v}</double></value>`;
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  return `<value><string>${esc(typeof v === "string" ? v : JSON.stringify(v))}</string></value>`;
}

function success(v) {
  return `<?xml version="1.0"?><methodResponse><params><param>${encodeValue(v)}</param></params></methodResponse>`;
}
function fault(code, message) {
  faults++;
  return `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>${code}</int></value></member><member><name>faultString</name><value><string>${esc(message)}</string></value></member></struct></value></fault></methodResponse>`;
}

const methods = {
  "math.add": (a, b) => Number(a) + Number(b),
  "math.multiply": (a, b) => Number(a) * Number(b),
  "system.echo": (v) => String(v),
  "stats.summary": () => JSON.stringify({ pid: process.pid, calls, faults, uptimeMs: Date.now() - startedAt }),
};

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, pid: process.pid, calls, faults, port: PORT }));
  }
  if (req.method !== "POST" || req.url !== "/RPC2") {
    res.writeHead(404);
    return res.end();
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    const { method, params } = parseCall(body);
    let out;
    if (!methods[method]) out = fault(-32601, `unknown method: ${method}`);
    else {
      try {
        out = success(methods[method](...params));
      } catch (e) {
        out = fault(-32500, e.message || String(e));
      }
    }
    res.writeHead(200, { "Content-Type": "text/xml", "Content-Length": Buffer.byteLength(out), "Cache-Control": "no-store" });
    res.end(out);
  });
});

server.on("error", (e) => {
  console.error(`XMLRPC-BIND-ERROR ${e.code || e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => console.log(`XMLRPC-READY http://127.0.0.1:${PORT}/RPC2 pid=${process.pid}`));
process.on("SIGTERM", () => process.exit(0));
