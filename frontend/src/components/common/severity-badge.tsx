import { Badge } from "@/components/ui/badge";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <Badge variant={severity === "info" ? "outline" : severity} className={cn("uppercase", className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABEL[severity]}
    </Badge>
  );
}
