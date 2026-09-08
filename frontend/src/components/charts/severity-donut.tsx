"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Severity } from "@/lib/types";

const COLOR: Record<Severity, string> = {
  critical: "hsl(var(--sev-critical))",
  high: "hsl(var(--sev-high))",
  medium: "hsl(var(--sev-medium))",
  low: "hsl(var(--sev-low))",
  info: "hsl(var(--sev-info))",
};

export function SeverityDonut({ counts }: { counts: Record<Severity, number> }) {
  const data = (Object.keys(counts) as Severity[])
    .map((k) => ({ name: k, value: counts[k] }))
    .filter((d) => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Pie
            data={data.length ? data : [{ name: "none", value: 1 }]}
            innerRadius={55}
            outerRadius={80}
            paddingAngle={3}
            strokeWidth={0}
            dataKey="value"
          >
            {(data.length ? data : [{ name: "none", value: 1 }]).map((entry, i) => (
              <Cell
                key={i}
                fill={data.length ? COLOR[entry.name as Severity] : "hsl(var(--surface-2))"}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Findings</div>
        <div className="text-2xl font-semibold tabular-nums">{total}</div>
      </div>
    </div>
  );
}
