#!/usr/bin/env node
/**
 * Backend worker process for the Distributed Systems Teaching Lab.
 * ------------------------------------------------------------------
 * Zero-dependency Node HTTP server. The control plane spawns three
 * copies: BE-4101 / BE-4102 / BE-4103.
 *
 * Capabilities:
 *   GET  /work          generic unit of work (configurable latency)
 *   GET  /clock         the process's OWN drifting logical clock
 *   POST /clock/adjust  Berkeley-style adjustment  { delta }
 *   POST /map           MapReduce map task          { text } → word counts
 *   GET  /healthz       liveness + live stats
 *   POST /config        { delayMs, driftPpm, offsetMs }
 *   POST /reset
 */
"use strict";

const http = require("http");

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const ID = String(arg("id", "BE-????"));
const PORT = Number(arg("port", "0"));

/* per-worker clock personality: its crystal runs slightly off */
const DEFAULTS = {
  4101: { driftPpm: -90, offsetMs: 420 },
  4102: { driftPpm: 45, offsetMs: -240 },
  4103: { driftPpm: 130, offsetMs: 160 },
};
const def = DEFAULTS[PORT] || { driftPpm: 0, offsetMs: 0 };

let delayMs = 0;
let served = 0;
let active = 0;
let driftPpm = def.driftPpm;
let offsetMs = def.offsetMs;
let adjustMs = 0; // accumulated Berkeley adjustments
const startedAt = Date.now();

function procClock() {
  return Date.now() + offsetMs + adjustMs + ((Date.now() - startedAt) * driftPpm) / 1e6;
}

function info() {
  return {
    id: ID,
    pid: process.pid,
    port: PORT,
    delayMs,
    served,
    active,
    clock: Math.round(procClock() * 1000) / 1000,
    clockSystem: Date.now(),
    driftPpm,
    offsetMs,
    adjustMs: Math.round(adjustMs * 1000) / 1000,
    uptimeMs: Date.now() - startedAt,
    ts: Date.now(),
  };
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

/** the actual map function: tokenize → count */
function mapWordCount(text) {
  const t0 = performance.now();
  const words = String(text).toLowerCase().match(/[a-z0-9']+/g) || [];
  const counts = {};
  for (const w of words) counts[w] = (counts[w] || 0) + 1;
  return {
    counts,
    words: words.length,
    keys: Object.keys(counts).length,
    ms: Math.max(0.1, Math.round((performance.now() - t0) * 100) / 100),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (url.pathname === "/work" && req.method === "GET") {
    active++;
    const seq = ++served;
    setTimeout(() => {
      active--;
      send(res, 200, { ok: true, seq, ...info() });
    }, delayMs);
    return;
  }

  if (url.pathname === "/clock" && req.method === "GET") {
    return send(res, 200, { ok: true, ...info() });
  }

  if (url.pathname === "/clock/adjust" && req.method === "POST") {
    const j = await readBody(req);
    if (typeof j.delta === "number") adjustMs += j.delta;
    return send(res, 200, { ok: true, appliedMs: j.delta ?? 0, ...info() });
  }

  if (url.pathname === "/map" && req.method === "POST") {
    const t0 = performance.now();
    const j = await readBody(req);
    const r = mapWordCount(j.text || "");
    served++;
    return send(res, 200, {
      ok: true,
      worker: ID,
      pid: process.pid,
      chunk: j.chunk ?? null,
      wallMs: Math.round((performance.now() - t0) * 100) / 100,
      ...r,
    });
  }

  if (url.pathname === "/healthz") {
    return send(res, 200, { ok: true, ...info() });
  }

  if (url.pathname === "/config" && req.method === "POST") {
    const j = await readBody(req);
    if (typeof j.delayMs === "number") delayMs = Math.max(0, Math.min(10000, j.delayMs));
    if (typeof j.driftPpm === "number") driftPpm = Math.max(-500, Math.min(500, j.driftPpm));
    if (typeof j.offsetMs === "number") offsetMs = Math.max(-60000, Math.min(60000, j.offsetMs));
    return send(res, 200, { ok: true, ...info() });
  }

  if (url.pathname === "/reset" && req.method === "POST") {
    served = 0;
    adjustMs = 0;
    return send(res, 200, { ok: true, ...info() });
  }

  send(res, 404, { ok: false, error: "not found", id: ID });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[${ID}] listening on http://127.0.0.1:${PORT} pid=${process.pid} clock=${Math.round(procClock())}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
