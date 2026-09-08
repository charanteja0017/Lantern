import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/types";

const MAP: Record<RunStatus, { label: string; variant: "success" | "warning" | "danger" | "info" | "primary" | "default" }> = {
  queued: { label: "Queued", variant: "default" },
  running: { label: "Running", variant: "primary" },
  paused: { label: "Paused", variant: "warning" },
  throttled: { label: "Throttled", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  stopped: { label: "Stopped", variant: "default" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const { label, variant } = MAP[status];
  const pulsing = status === "running" || status === "throttled";
  return (
    <Badge variant={variant}>
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${pulsing ? "animate-pulse-dot" : ""}`}
      />
      {label}
    </Badge>
  );
}
