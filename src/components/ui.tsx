"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/* ------------------------------ Section label ---------------------------- */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="mono text-[10px] tracking-[0.22em] uppercase acc-text">{children}</span>
      <span className="h-px flex-1" style={{ background: "var(--line)" }} />
      {right}
    </div>
  );
}

/* --------------------------------- Stat ---------------------------------- */
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ok" | "warn" | "err" | "acc";
}) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "err"
          ? "var(--err)"
          : tone === "acc"
            ? "var(--accent)"
            : "var(--ink)";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="mono text-[9.5px] tracking-[0.18em] uppercase" style={{ color: "var(--faint)" }}>
        {label}
      </span>
      <span className="mono tnum text-lg leading-6 font-semibold" style={{ color }}>
        {value}
      </span>
      {sub && (
        <span className="mono text-[10px]" style={{ color: "var(--faint)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

/* --------------------------------- LED ----------------------------------- */
export function Led({ tone = "on", title }: { tone?: "on" | "acc" | "err" | "warn" | "off"; title?: string }) {
  return (
    <span
      title={title}
      className={`led ${tone === "off" ? "" : tone}`}
      style={tone === "off" ? { background: "var(--faint)" } : undefined}
    />
  );
}

/* -------------------------------- Terminal ------------------------------- */
export interface LogLine {
  kind: "info" | "ok" | "warn" | "err" | "dim";
  text: string;
  ts?: string;
}

const GLYPHS: Record<LogLine["kind"], string> = {
  info: "›",
  ok: "+",
  warn: "!",
  err: "×",
  dim: "·",
};

export function Terminal({ lines, height = 220 }: { lines: LogLine[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div ref={ref} className="terminal py-2" style={{ ["--th" as string]: `${height}px` }}>
      {lines.length === 0 && (
        <div className="tline k-dim">
          <span className="g">·</span>
          <span>awaiting activity…</span>
        </div>
      )}
      {lines.map((l, i) => (
        <div key={i} className={`tline k-${l.kind}`}>
          <span className="g">{GLYPHS[l.kind]}</span>
          {l.ts && <span className="ts">{l.ts}</span>}
          <span className="break-all">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Toggle --------------------------------- */
export function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button className="flex items-center gap-3 cursor-pointer group text-left" onClick={() => onChange(!on)}>
      <span className={`tgl ${on ? "on" : ""}`} />
      <span className="flex flex-col">
        <span className="mono text-[11px] tracking-wide group-hover:text-white transition-colors" style={{ color: on ? "var(--ink)" : "var(--dim)" }}>
          {label}
        </span>
        {hint && (
          <span className="mono text-[9.5px]" style={{ color: "var(--faint)" }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

/* ------------------------------- NeonSlider ------------------------------ */
export function NeonSlider({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className="nslider"
      style={{ ["--val" as string]: `${pct}%`, opacity: disabled ? 0.35 : 1 }}
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/* --------------------------------- Badge --------------------------------- */
export function Badge({ children, tone = "acc" }: { children: ReactNode; tone?: "acc" | "ok" | "warn" | "err" }) {
  const styles: Record<string, CSSProperties> = {
    acc: {},
    ok: { borderColor: "rgba(255,255,255,.4)", background: "rgba(255,255,255,.07)", color: "#eceff1" },
    warn: { borderColor: "rgba(255,255,255,.3)", borderStyle: "dashed", color: "#b9bfc4" },
    /* alarm = inverted solid white */
    err: { borderColor: "rgba(255,255,255,.85)", background: "#f2f3f4", color: "#0a0a0b", fontWeight: 700 },
  };
  return (
    <span className={`chip ${tone === "acc" ? "chip-acc" : ""}`} style={styles[tone]}>
      {children}
    </span>
  );
}


