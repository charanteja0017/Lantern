"use client";

import { CheckCircle2, ChevronRight, CircleDashed, Terminal, XCircle } from "lucide-react";
import type { AgentNode, ToolExecution } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

const ICON = {
  completed: CheckCircle2,
  running: CircleDashed,
  error: XCircle,
  failed: XCircle,
} as const;

const COLOR = {
  completed: "text-emerald-300",
  running: "text-primary",
  error: "text-red-300",
  failed: "text-red-300",
} as const;

function commandLine(t: ToolExecution): string {
  const args = t.args ?? {};
  const direct = typeof args.cmd === "string" ? args.cmd : typeof args.command === "string" ? args.command : null;
  if (direct) return direct;
  if (Object.keys(args).length === 0) return t.toolName;
  const flat = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return `${t.toolName} ${flat}`;
}

function agentName(agents: AgentNode[] | undefined, id: string): string {
  return agents?.find((a) => a.id === id)?.name ?? id;
}

export function ToolStream({
  tools,
  agents,
  showAgent = false,
}: {
  tools: ToolExecution[];
  agents?: AgentNode[];
  showAgent?: boolean;
}) {
  const sorted = [...tools].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No commands executed yet.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sorted.map((t) => {
        const Icon = ICON[t.status];
        const cmd = commandLine(t);
        return (
          <li key={t.id} className="rounded-lg border border-border bg-surface/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-[11px] text-muted-foreground">{t.toolName}</span>
                {showAgent && (
                  <span className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    {agentName(agents, t.agentId)}
                  </span>
                )}
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${COLOR[t.status]} ${
                    t.status === "running" ? "animate-pulse-dot" : ""
                  }`}
                />
                {typeof t.exitCode === "number" && (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      t.exitCode === 0
                        ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-red-500/10 text-red-300"
                    }`}
                  >
                    exit {t.exitCode}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {formatRelativeTime(t.startedAt)}
              </span>
            </div>

            <pre className="mt-2 flex items-start gap-2 overflow-x-auto rounded bg-background/70 p-2 font-mono text-[11px]">
              <ChevronRight className="mt-[1px] h-3 w-3 shrink-0 text-primary" />
              <code className="whitespace-pre-wrap break-all">{cmd}</code>
            </pre>

            {t.output ? (
              <pre className="mt-1 overflow-x-auto rounded bg-background/40 p-2 font-mono text-[11px] text-muted-foreground">
                {t.output}
              </pre>
            ) : t.status === "running" ? (
              <div className="mt-1 px-1 font-mono text-[11px] text-muted-foreground">
                <span className="inline-block animate-pulse">running…</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
