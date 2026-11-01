#!/usr/bin/env node
/**
 * TCP broker process — a real TCP server (node:net), no HTTP.
 * ------------------------------------------------------------------
 *     node scripts/tcp-server.js --port 5101
 *
 * Line-based wire protocol (newline-delimited):
 *   client →  MSG|<id>|<payload>
 *   server →  ACK|<id>|<bytesReceived>|<serverSeq>
 *   client →  STATS
 *   server →  STATS|{json}
 *
 * The control plane connects over real TCP sockets — per message
 * (handshake each time) or via a persistent pooled connection — so the
 * dashboard can show genuine handshake vs. reuse behavior.
 */
"use strict";

const net = require("net");

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const PORT = Number(arg("port", "5101"));

const stats = {
  pid: process.pid,
  port: PORT,
  connectionsTotal: 0,
  connectionsActive: 0,
  connsReused: 0, // connections that carried >1 message
  messages: 0,
  bytesRx: 0,
  bytesTx: 0,
  startedAt: Date.now(),
};

const server = net.createServer((sock) => {
  stats.connectionsTotal++;
  stats.connectionsActive++;
  let buffer = "";
  let msgsOnThisConn = 0;

  sock.on("data", (chunk) => {
    stats.bytesRx += chunk.length;
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handleLine(line.trim(), sock, () => {
        msgsOnThisConn++;
        if (msgsOnThisConn === 2) stats.connsReused++;
      });
    }
  });
  const drop = () => {
    stats.connectionsActive = Math.max(0, stats.connectionsActive - 1);
  };
  sock.on("close", drop);
  sock.on("error", () => undefined);
});

function handleLine(line, sock, bumpMsg) {
  if (!line) return;
  if (line === "STATS") {
    write(sock, `STATS|${JSON.stringify({ ...stats, ts: Date.now() })}`);
    return;
  }
  if (line.startsWith("MSG|")) {
    const bar1 = line.indexOf("|");
    const bar2 = line.indexOf("|", bar1 + 1);
    const id = line.slice(bar1 + 1, bar2);
    const payload = line.slice(bar2 + 1);
    stats.messages++;
    bumpMsg();
    write(sock, `ACK|${id}|${Buffer.byteLength(payload)}|${stats.messages}`);
  } else if (line === "PING") {
    write(sock, "PONG");
  } else {
    write(sock, "ERR|unknown command");
  }
}

function write(sock, line) {
  const data = line + "\n";
  stats.bytesTx += Buffer.byteLength(data);
  sock.write(data);
}

server.on("error", (e) => {
  console.error(`TCP-BIND-ERROR ${e.code || e.message} — orphan likely holds :${PORT}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`TCP-LISTENING 127.0.0.1:${PORT} pid=${process.pid}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
