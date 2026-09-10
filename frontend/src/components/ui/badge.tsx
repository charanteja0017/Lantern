import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-2 text-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success:
          "border-live/40 bg-live/10 text-live",
        warning:
          "border-severity-medium/40 bg-severity-medium/10 text-severity-medium",
        danger:
          "border-severity-critical/40 bg-severity-critical/10 text-severity-critical",
        info: "border-severity-low/40 bg-severity-low/10 text-severity-low",
        primary:
          "border-primary/40 bg-primary/10 text-primary",
        // Severity variants read from the --sev-* tokens so the ramp is
        // defined once, in globals.css, and cannot drift between the badge
        // and the charts/donut that plot the same scale.
        critical:
          "border-severity-critical/40 bg-severity-critical/15 text-severity-critical",
        high: "border-severity-high/40 bg-severity-high/15 text-severity-high",
        medium:
          "border-severity-medium/40 bg-severity-medium/15 text-severity-medium",
        low: "border-severity-low/40 bg-severity-low/15 text-severity-low",
        live: "border-live/40 bg-live/10 text-live",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
