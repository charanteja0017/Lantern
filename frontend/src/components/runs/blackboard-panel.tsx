"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProvider } from "@/lib/api";
import type { BlackboardFindingRow } from "@/lib/types";

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n >= 100 ? n.toFixed(0) : n.toFixed(3);
}

export function BlackboardPanel({
  runId,
  streaming,
}: {
  runId: string;
  streaming: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BlackboardFindingRow[]>([]);
  const [kindFilter, setKindFilter] = useState<string>("");

  const kinds = useMemo(() => {
    const raw = kindFilter
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    return raw.length ? raw : undefined;
  }, [kindFilter]);

  const refresh = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const res = await getProvider().getRunBlackboard(runId, { limit: 200, offset: 0, kind: kinds });
      setItems(res.items || []);
    } finally {
      setLoading(false);
    }
  }, [runId, kinds]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Swarm blackboard
            {streaming ? (
              <Badge variant="primary" className="ml-2 gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
                Live
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Shared findings emitted by the nova runtime (sorted by effective pheromone).
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => refresh()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">
              Kind filter (comma-separated, optional)
            </label>
            <Input
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              placeholder="ToolResult,HttpEndpoint,PortOpen"
              spellCheck={false}
            />
          </div>
          <div className="pt-5 md:pt-0">
            <Button size="sm" onClick={() => refresh()} disabled={loading}>
              Apply
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-md border border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
            No blackboard findings yet.
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 200).map((f) => (
              <div
                key={f.id}
                className="rounded-md border border-border bg-surface/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {f.kind}
                  </Badge>
                  <span className="font-mono text-[10px] opacity-80">eff {formatNum(f.effective_pheromone)}</span>
                  <span className="font-mono text-[10px] opacity-80">ph {formatNum(f.pheromone)}</span>
                  <span className="ml-auto font-mono text-[10px] opacity-70">{f.created_at}</span>
                </div>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/50 p-2 font-mono text-[11px] text-foreground/80">
                  {JSON.stringify(f.payload ?? {}, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

