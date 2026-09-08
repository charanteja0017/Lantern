"use client";

import { Bot, CheckCircle2, CircleAlert, CircleDashed, Clock, XCircle } from "lucide-react";
import type { AgentNode, AgentStatus } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

const STATUS_ICON: Record<AgentStatus, React.ComponentType<{ className?: string }>> = {
  running: CircleDashed,
  waiting: Clock,
  completed: CheckCircle2,
  failed: XCircle,
  stopped: CircleAlert,
  llm_failed: CircleAlert,
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  running: "text-primary",
  waiting: "text-amber-300",
  completed: "text-emerald-300",
  failed: "text-red-300",
  stopped: "text-muted-foreground",
  llm_failed: "text-red-300",
};

export function AgentTree({
  agents,
  selectedId,
  onSelect,
}: {
  agents: AgentNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const byParent = new Map<string | null, AgentNode[]>();
  for (const a of agents) {
    const list = byParent.get(a.parentId) ?? [];
    list.push(a);
    byParent.set(a.parentId, list);
  }
  const roots = byParent.get(null) ?? [];

  return (
    <ul className="space-y-1">
      {roots.map((r) => (
        <AgentItem
          key={r.id}
          agent={r}
          depth={0}
          byParent={byParent}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function AgentItem({
  agent,
  depth,
  byParent,
  selectedId,
  onSelect,
}: {
  agent: AgentNode;
  depth: number;
  byParent: Map<string | null, AgentNode[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const Icon = STATUS_ICON[agent.status];
  const children = byParent.get(agent.id) ?? [];
  const active = selectedId === agent.id;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(agent.id)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          active
            ? "bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]"
            : "hover:bg-surface-2/60",
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <Bot
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate font-medium">{agent.name}</span>
        <Icon
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0",
            STATUS_COLOR[agent.status],
            agent.status === "running" && "animate-pulse-dot",
          )}
        />
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {formatNumber(agent.tokens)}
        </span>
      </button>
      {children.length > 0 ? (
        <ul>
          {children.map((c) => (
            <AgentItem
              key={c.id}
              agent={c}
              depth={depth + 1}
              byParent={byParent}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
