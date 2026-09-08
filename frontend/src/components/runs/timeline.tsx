"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  Bug,
  CheckCircle2,
  CircleStop,
  MessageSquare,
  PauseCircle,
  Play,
  Save,
  Wrench,
  XCircle,
} from "lucide-react";
import type { TimelineEvent } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

const ICONS: Record<TimelineEvent["type"], React.ComponentType<{ className?: string }>> = {
  "run.started": Play,
  "run.configured": Activity,
  "run.completed": CheckCircle2,
  "run.failed": XCircle,
  "run.stopped": CircleStop,
  "agent.created": Bot,
  "agent.status.updated": Bot,
  "tool.execution.started": Wrench,
  "tool.execution.updated": Wrench,
  "chat.message": MessageSquare,
  "finding.created": Bug,
  "finding.reviewed": Bug,
  "run.checkpoint": Save,
  "llm.throttled": AlertTriangle,
  "llm.resumed": PauseCircle,
  "nova.finding.created": Bug,
  "nova.finding.boosted": CheckCircle2,
};

const SEV_COLOR: Record<string, string> = {
  critical: "text-red-300",
  high: "text-orange-300",
  medium: "text-amber-300",
  low: "text-sky-300",
  info: "text-muted-foreground",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ul className="relative space-y-0">
      <div
        className="pointer-events-none absolute left-[13px] top-0 h-full w-px bg-border"
        aria-hidden
      />
      {events
        .slice()
        .reverse()
        .map((ev) => {
          const Icon = ICONS[ev.type] ?? Activity;
          const color =
            ev.severity && SEV_COLOR[ev.severity]
              ? SEV_COLOR[ev.severity]
              : "text-muted-foreground";
          return (
            <li key={ev.id} className="relative flex gap-3 py-2.5 pl-1">
              <div className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{ev.message}</div>
                <div className="text-[11px] text-muted-foreground">
                  {ev.actor?.agentName ? `${ev.actor.agentName} · ` : ""}
                  {formatRelativeTime(ev.timestamp)}
                  {ev.status ? ` · ${ev.status}` : ""}
                </div>
              </div>
            </li>
          );
        })}
    </ul>
  );
}
