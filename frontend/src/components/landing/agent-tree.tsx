"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleDot,
  FileSearch,
  GitBranch,
  Lock,
  Network,
  Radio,
  Target,
} from "lucide-react";

type Status = "spawning" | "running" | "found" | "done";

type Node = {
  id: string;
  parentId: string | null;
  label: string;
  task: string;
  icon: React.ComponentType<{ className?: string }>;
  status: Status;
  findings?: number;
};

const TIMELINE: { at: number; node: Node }[] = [
  {
    at: 0,
    node: {
      id: "root",
      parentId: null,
      label: "HunterAgent · root",
      task: "orchestrating",
      icon: Bot,
      status: "running",
    },
  },
  {
    at: 900,
    node: {
      id: "recon",
      parentId: "root",
      label: "recon_001",
      task: "mapping /api surface",
      icon: Network,
      status: "spawning",
    },
  },
  {
    at: 1700,
    node: {
      id: "auth",
      parentId: "root",
      label: "auth_bypass_002",
      task: "probing /api/users/{id}",
      icon: Lock,
      status: "spawning",
    },
  },
  {
    at: 2500,
    node: {
      id: "sqli",
      parentId: "root",
      label: "sqli_scanner_003",
      task: "fuzzing /auth/login",
      icon: Target,
      status: "spawning",
    },
  },
  {
    at: 3200,
    node: {
      id: "auth-child",
      parentId: "auth",
      label: "payload_gen_004",
      task: "crafting IDOR payload",
      icon: FileSearch,
      status: "spawning",
    },
  },
  {
    at: 4000,
    node: {
      id: "repo",
      parentId: "root",
      label: "source_review_005",
      task: "scanning repo/main.js",
      icon: GitBranch,
      status: "spawning",
    },
  },
];

const UPDATES: { at: number; id: string; status: Status; findings?: number }[] = [
  { at: 1600, id: "recon", status: "running" },
  { at: 2400, id: "auth", status: "running" },
  { at: 3200, id: "sqli", status: "running" },
  { at: 3800, id: "recon", status: "done" },
  { at: 4200, id: "auth-child", status: "running" },
  { at: 4600, id: "repo", status: "running" },
  { at: 4900, id: "auth", status: "found", findings: 1 },
  { at: 5600, id: "sqli", status: "found", findings: 2 },
  { at: 6300, id: "repo", status: "found", findings: 1 },
  { at: 6800, id: "auth-child", status: "done" },
  { at: 7600, id: "sqli", status: "done" },
];

const STATUS_STYLE: Record<Status, { ring: string; pill: string; label: string }> = {
  spawning: {
    ring: "border-sky-400/40 bg-sky-400/5",
    pill: "bg-sky-400/15 text-sky-300",
    label: "spawning",
  },
  running: {
    ring: "border-primary/40 bg-primary/5",
    pill: "bg-primary/20 text-primary",
    label: "running",
  },
  found: {
    ring: "border-red-500/50 bg-red-500/5 shadow-[0_0_0_3px_hsl(0_84%_60%/0.12)]",
    pill: "bg-red-500/20 text-red-300",
    label: "finding",
  },
  done: {
    ring: "border-emerald-500/30 bg-emerald-500/5",
    pill: "bg-emerald-500/15 text-emerald-300",
    label: "done",
  },
};

export function AgentTree() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let cycleStart = performance.now();
    const appliedTimeline = new Set<number>();
    const appliedUpdates = new Set<number>();
    let lastTickRender = 0;

    const loop = (now: number) => {
      if (cancelled) return;
      const elapsed = now - cycleStart;

      if (elapsed > 9500) {
        setNodes([]);
        setTick(0);
        appliedTimeline.clear();
        appliedUpdates.clear();
        window.setTimeout(() => {
          if (cancelled) return;
          cycleStart = performance.now();
          lastTickRender = 0;
          raf = requestAnimationFrame(loop);
        }, 800);
        return;
      }

      // Throttle tick re-renders to ~10 Hz (enough for "t+X.Xs" display).
      if (elapsed - lastTickRender >= 100) {
        lastTickRender = elapsed;
        setTick(elapsed);
      }

      TIMELINE.forEach((entry, i) => {
        if (!appliedTimeline.has(i) && elapsed >= entry.at) {
          appliedTimeline.add(i);
          setNodes((prev) =>
            prev.some((n) => n.id === entry.node.id) ? prev : [...prev, entry.node],
          );
        }
      });

      UPDATES.forEach((u, i) => {
        if (!appliedUpdates.has(i) && elapsed >= u.at) {
          appliedUpdates.add(i);
          setNodes((prev) =>
            prev.map((n) =>
              n.id === u.id
                ? {
                    ...n,
                    status: u.status,
                    findings:
                      u.findings !== undefined
                        ? (n.findings ?? 0) + u.findings
                        : n.findings,
                  }
                : n,
            ),
          );
        }
      });

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const rootNodes = nodes.filter((n) => n.parentId === null);
  const totalFindings = nodes.reduce((acc, n) => acc + (n.findings ?? 0), 0);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-background/80 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.35)] backdrop-blur-lg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Radio className="h-3 w-3 text-primary animate-pulse-dot" />
          <span className="font-mono">agent nova · {nodes.length} agents alive</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px]">
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-red-300">
            {totalFindings} findings
          </span>
        </div>
      </div>

      <div className="relative h-[420px] overflow-hidden px-5 py-4">
        <div className="space-y-2">
          {rootNodes.map((root) => (
            <TreeNode key={root.id} node={root} all={nodes} depth={0} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/90 to-transparent" />
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {nodes.filter((n) => n.status === "running").length} running
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {nodes.filter((n) => n.status === "done").length} done
          </span>
        </div>
        <span>checkpoint committed · t+{Math.floor(tick / 100) / 10}s</span>
      </div>
    </div>
  );
}

function TreeNode({ node, all, depth }: { node: Node; all: Node[]; depth: number }) {
  const children = all.filter((n) => n.parentId === node.id);
  const style = STATUS_STYLE[node.status];
  const Icon = node.icon;

  return (
    <div className="fade-up in">
      <div className="relative flex items-stretch gap-3">
        {depth > 0 && (
          <div className="relative w-5 shrink-0">
            <span className="absolute left-2 top-0 h-full w-px bg-border" />
            <span className="absolute left-2 top-4 h-px w-3 bg-border" />
          </div>
        )}
        <div
          className={`flex-1 rounded-lg border ${style.ring} px-3 py-2 transition-all`}
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{node.label}</span>
                {node.findings ? (
                  <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                    +{node.findings}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <CircleDot
                  className={`h-2.5 w-2.5 ${
                    node.status === "running" ? "animate-pulse text-primary" : ""
                  }`}
                />
                <span className="truncate">{node.task}</span>
              </div>
            </div>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${style.pill}`}>
              {style.label}
            </span>
          </div>
        </div>
      </div>
      {children.length > 0 && (
        <div className="mt-2 space-y-2 pl-4">
          {children.map((c) => (
            <TreeNode key={c.id} node={c} all={all} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
