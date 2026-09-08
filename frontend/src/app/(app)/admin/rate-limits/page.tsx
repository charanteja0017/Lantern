"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProvider } from "@/lib/api";
import type { RateLimitSnapshot } from "@/lib/types";

export default function AdminRateLimitsPage() {
  const [snapshots, setSnapshots] = useState<RateLimitSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await getProvider().getRateLimitSnapshots();
      setSnapshots(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(load, 10000);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  const onRefresh = () => {
    load().then(() => toast.success("Snapshot refreshed."));
  };

  const keyFor = (s: RateLimitSnapshot) => `${s.provider}/${s.model}`;

  const togglePause = (s: RateLimitSnapshot) => {
    const k = keyFor(s);
    const next = !paused[k];
    setPaused((p) => ({ ...p, [k]: next }));
    toast.success(
      next
        ? `${s.provider}/${s.model} paused — new work will queue.`
        : `${s.provider}/${s.model} resumed.`,
    );
  };

  return (
    <>
      <PageHeader
        title="Rate limits"
        description="Per-provider TPM/RPM pressure, queued work, and retry counts."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Auto refresh
            </label>
            <Button size="sm" variant="outline" onClick={onRefresh}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Refresh now
            </Button>
          </div>
        }
      />
      {loading && snapshots.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {snapshots.map((s) => {
            const tpmPct = (s.tpm.used / s.tpm.limit) * 100;
            const rpmPct = (s.rpm.used / s.rpm.limit) * 100;
            const Icon = s.status === "ok" ? CheckCircle2 : AlertTriangle;
            const isPaused = paused[keyFor(s)];
            return (
              <Card key={keyFor(s)}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="capitalize">{s.provider}</CardTitle>
                    <CardDescription>{s.model}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaused && <Badge variant="warning">Paused</Badge>}
                    <Badge
                      variant={
                        s.status === "ok"
                          ? "success"
                          : s.status === "throttled"
                            ? "warning"
                            : "danger"
                      }
                    >
                      <Icon className="h-3 w-3" />
                      {s.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">TPM</span>
                      <span className="tabular-nums">
                        {s.tpm.used.toLocaleString()} / {s.tpm.limit.toLocaleString()}
                      </span>
                    </div>
                    <Progress
                      value={tpmPct}
                      indicatorClassName={tpmPct > 80 ? "bg-amber-400" : "bg-primary"}
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">RPM</span>
                      <span className="tabular-nums">
                        {s.rpm.used} / {s.rpm.limit}
                      </span>
                    </div>
                    <Progress value={rpmPct} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                    <div className="rounded-md border border-border bg-surface/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Queued
                      </div>
                      <div className="text-lg font-semibold tabular-nums">{s.queued}</div>
                    </div>
                    <div className="rounded-md border border-border bg-surface/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Retries
                      </div>
                      <div className="text-lg font-semibold tabular-nums">
                        {s.retries} <RefreshCw className="inline h-3 w-3" />
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isPaused ? "default" : "outline"}
                    className="w-full"
                    onClick={() => togglePause(s)}
                  >
                    {isPaused ? (
                      <>
                        <Play className="mr-1 h-3.5 w-3.5" />
                        Resume provider
                      </>
                    ) : (
                      <>
                        <Pause className="mr-1 h-3.5 w-3.5" />
                        Pause provider
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
