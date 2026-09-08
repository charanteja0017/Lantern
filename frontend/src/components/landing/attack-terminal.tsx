"use client";

import { useEffect, useRef, useState } from "react";
import { CircleDot } from "lucide-react";

type Line =
  | { kind: "prompt"; text: string }
  | { kind: "out"; text: string; tone?: "ok" | "warn" | "danger" | "muted" }
  | { kind: "blank" };

const SCRIPT: Line[] = [
  { kind: "prompt", text: "novahunter run --target https://api.acme.com --mode standard" },
  { kind: "out", text: "✓ Workspace isolated (sandbox_id=sb_7f2a)", tone: "ok" },
  { kind: "out", text: "→ spawning HunterAgent(root) …", tone: "muted" },
  { kind: "blank" },
  { kind: "prompt", text: "[root] recon ▸ listing endpoints" },
  { kind: "out", text: "curl -s https://api.acme.com/openapi.json | jq '.paths | keys | length'", tone: "muted" },
  { kind: "out", text: "42", tone: "ok" },
  { kind: "blank" },
  { kind: "prompt", text: "[root] spawn_agent(type=auth_bypass, target=/api/users/{id})" },
  { kind: "out", text: "→ child: auth_bypass_001 thinking …", tone: "muted" },
  { kind: "out", text: "probe: GET /api/users/1001  (auth: victim)", tone: "muted" },
  { kind: "out", text: "HTTP/1.1 200 OK  ← leaks email, billing, sessionToken", tone: "danger" },
  { kind: "blank" },
  { kind: "prompt", text: "[auth_bypass] create_finding(severity=high, cwe=CWE-639)" },
  { kind: "out", text: "✓ Finding IDOR-0417 attached to run-aurora-01", tone: "ok" },
  { kind: "out", text: "  severity: HIGH    cvss: 8.1    reproducible: yes", tone: "warn" },
  { kind: "blank" },
  { kind: "prompt", text: "[root] status" },
  { kind: "out", text: "3 agents alive · 128 tools · 1 critical · 3 high · 2 medium", tone: "ok" },
  { kind: "out", text: "checkpoint committed → resumable from any device", tone: "muted" },
];

const TONE: Record<"ok" | "warn" | "danger" | "muted", string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  danger: "text-red-300",
  muted: "text-muted-foreground",
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const id = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function AttackTerminal() {
  const [rendered, setRendered] = useState<Line[]>([]);
  const [typing, setTyping] = useState<string>("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const loop = async () => {
      try {
        while (!signal.aborted) {
          setRendered([]);
          setTyping("");
          for (const line of SCRIPT) {
            if (signal.aborted) return;
            if (line.kind === "prompt") {
              for (let i = 1; i <= line.text.length; i += 1) {
                if (signal.aborted) return;
                setTyping(line.text.slice(0, i));
                await sleep(22, signal);
              }
              await sleep(240, signal);
              if (signal.aborted) return;
              setRendered((prev) => [...prev, line]);
              setTyping("");
            } else {
              await sleep(line.kind === "blank" ? 120 : 380, signal);
              if (signal.aborted) return;
              setRendered((prev) => [...prev, line]);
            }
          }
          await sleep(4500, signal);
        }
      } catch {
        /* aborted */
      }
    };

    loop();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rendered, typing]);

  return (
    <div className="relative rounded-xl border border-border bg-background/80 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.35)] backdrop-blur-lg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CircleDot className="h-3 w-3 text-emerald-400 animate-pulse-dot" />
          <span className="font-mono">novahunter — live scan · run-aurora-01</span>
        </div>
        <div className="ml-auto hidden gap-2 text-[10px] font-mono text-muted-foreground md:flex">
          <span className="rounded border border-border px-1.5 py-0.5">sandbox</span>
          <span className="rounded border border-border px-1.5 py-0.5">read-only host</span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative h-[420px] overflow-hidden px-4 py-3 font-mono text-[12.5px] leading-relaxed"
      >
        <div className="space-y-[2px]">
          {rendered.map((line, idx) => {
            if (line.kind === "blank") return <div key={idx} className="h-2" />;
            if (line.kind === "prompt") {
              return (
                <div key={idx} className="flex gap-2">
                  <span className="select-none text-primary">❯</span>
                  <span className="text-foreground">{line.text}</span>
                </div>
              );
            }
            const toneClass = line.tone ? TONE[line.tone] : "text-foreground";
            return (
              <div key={idx} className={`pl-4 ${toneClass}`}>
                {line.text}
              </div>
            );
          })}
          {typing && (
            <div className="flex gap-2">
              <span className="select-none text-primary">❯</span>
              <span className="text-foreground">
                {typing}
                <span className="ml-0.5 inline-block h-[14px] w-[8px] translate-y-[2px] bg-primary animate-caret" />
              </span>
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background/80 to-transparent" />
      </div>
    </div>
  );
}
