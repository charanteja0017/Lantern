"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Finding } from "@/lib/types";
import { SeverityBadge } from "@/components/common/severity-badge";
import { formatRelativeTime } from "@/lib/utils";

export function FindingsPanel({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No findings discovered yet for this run.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {findings.map((f) => (
        <li key={f.id}>
          <Link
            href={`/findings/${f.id}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/60 p-3 transition-colors hover:bg-surface-2/60"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <SeverityBadge severity={f.severity} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {f.description}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {f.target ?? "—"}
                  {f.endpoint ? ` · ${f.method ?? "GET"} ${f.endpoint}` : ""} ·{" "}
                  {formatRelativeTime(f.timestamp)}
                </div>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
