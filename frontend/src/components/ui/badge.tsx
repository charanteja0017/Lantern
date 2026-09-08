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
          "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        warning:
          "border-amber-400/30 bg-amber-400/10 text-amber-300",
        danger: "border-red-400/30 bg-red-400/10 text-red-300",
        info: "border-sky-400/30 bg-sky-400/10 text-sky-300",
        primary:
          "border-primary/40 bg-primary/10 text-primary",
        critical: "border-red-500/40 bg-red-500/15 text-red-300",
        high: "border-orange-500/40 bg-orange-500/15 text-orange-300",
        medium: "border-amber-500/40 bg-amber-500/15 text-amber-300",
        low: "border-sky-500/40 bg-sky-500/15 text-sky-300",
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
