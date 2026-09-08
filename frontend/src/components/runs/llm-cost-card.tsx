"use client";

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getProvider } from "@/lib/api";
import { formatCost, formatNumber } from "@/lib/utils";
import type { RunLlmUsage } from "@/lib/types";

export function LlmCostCard({ runId }: { runId: string }) {
  const [data, setData] = useState<RunLlmUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getProvider()
      .getRunLlmUsage(runId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          LLM cost breakdown
        </CardTitle>
        <CardDescription>
          Per-role tokens and dollars consumed by this run. Data is derived from{" "}
          <code>llm.call.completed</code> events streamed by the agent loop.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}
        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                <span className="text-foreground tabular-nums">
                  {formatNumber(data.total.tokens)}
                </span>{" "}
                tokens
              </span>
              <span>·</span>
              <span>
                <span className="text-foreground tabular-nums">
                  {formatCost(data.total.cost_usd)}
                </span>{" "}
                spent
              </span>
              <span>·</span>
              <span>
                <span className="text-foreground tabular-nums">{data.total.requests}</span>{" "}
                requests
              </span>
            </div>

            {data.by_role.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No LLM activity yet for this run.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2/60 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Role</th>
                      <th className="px-3 py-2 text-left">Model</th>
                      <th className="px-3 py-2 text-right">Tokens</th>
                      <th className="px-3 py-2 text-right">Requests</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                      <th className="px-3 py-2 text-right">Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_role.map((row) => {
                      const cap = row.budget?.cost_usd;
                      return (
                        <tr key={row.role} className="border-t border-border">
                          <td className="px-3 py-2">
                            <Badge variant="default" className="font-mono">
                              {row.role}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                            {row.model || "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(row.tokens)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.requests}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCost(row.cost_usd)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {cap != null ? formatCost(cap) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}
      </CardContent>
    </Card>
  );
}
