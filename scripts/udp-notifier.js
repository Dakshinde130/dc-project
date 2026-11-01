#!/usr/bin/env node
/**
 * UDP notifier process — emits real UDP datagrams (node:dgram).
 * ------------------------------------------------------------------
 *     node scripts/udp-notifier.js --target 5201 --control 5202
 *
 * Sends JSON datagrams to the control plane (127.0.0.1:5201):
 *     { seq, kind, value, ts, pid, dropped }
 *
 * Listens on 127.0.0.1:5202 for config datagrams from the control plane:
 *     { rateMs, lossPct, running }
 *
 * "lossPct" makes the sender withhold datagrams — from the receiver's
 * perspective this is indistinguishable from real packet loss, which the
 * receiver detects via sequence-number gaps.
 */
"use strict";

const dgram = require("dgram");

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const TARGET = Number(arg("target", "5201"));
const CONTROL = Number(arg("control", "5202"));

let rateMs = 220;
let lossPct = 10;
let running = false;
let seq = 0;
let dropped = 0;
let emitted = 0;

const KINDS = ["metric", "heartbeat", "metric", "event", "metric", "alert"];
let tick = 0;

const out = dgram.createSocket("udp4");
const ctl = dgram.createSocket("udp4");
out.unref?.();

function payload() {
  tick++;
  const kind = KINDS[tick % KINDS.length];
  const phase = tick / 6;
  const base = 50 + 40 * Math.sin(phase) + Math.random() * 8;
  const value =
    kind === "metric"
      ? Math.round(base * 100) / 100
      : kind === "alert"
        ? `threshold breach #${tick}`
        : kind === "event"
          ? `sensor probe ${tick} online`
          : "alive";
  // NOTE: seq is assigned per tick (in loop) so withheld datagrams leave holes
  return { seq, kind, value, ts: Date.now(), pid: process.pid, dropped };
}

function loop() {
  if (running) {
    seq++; // the sequence number exists whether or not the datagram survives
    if (Math.random() * 100 < lossPct) {
      dropped++; // withheld — indistinguishable from real loss to the receiver
    } else {
      const buf = Buffer.from(JSON.stringify(payload()));
      out.send(buf, 0, buf.length, TARGET, "127.0.0.1", () => undefined);
      emitted++;
    }
  }
  setTimeout(loop, rateMs);
}

ctl.on("message", (msg) => {
  try {
    const j = JSON.parse(msg.toString("utf8"));
    if (typeof j.rateMs === "number") rateMs = Math.max(20, Math.min(5000, j.rateMs));
    if (typeof j.lossPct === "number") lossPct = Math.max(0, Math.min(90, j.lossPct));
    if (typeof j.running === "boolean") running = j.running;
    if (j.reset) {
      seq = 0;
      dropped = 0;
      emitted = 0;
    }
  } catch {
    /* ignore malformed control datagrams */
  }
});

ctl.on("error", (e) => {
  console.error(`UDP-CTL-BIND-ERROR ${e.code || e.message} — orphan likely holds :${CONTROL}`);
  process.exit(1);
});

ctl.bind(CONTROL, "127.0.0.1", () => {
  console.log(`UDP-READY target=127.0.0.1:${TARGET} control=:${CONTROL} pid=${process.pid}`);
});

loop();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
