"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, Share2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExportFormatMenu } from "@/components/reports/export-format-menu";
import { getProvider } from "@/lib/api";
import type { RunSummary } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

export default function ReportsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getProvider()
      .listRuns()
      .then((r) => {
        if (!cancelled) {
          setRuns(r);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.targets.join(",").toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle),
    );
  }, [q, runs]);

  const completed = filtered.filter((r) => r.status === "completed");
  const inProgress = filtered.filter((r) => r.status !== "completed");

  const onCopyShare = async (run: RunSummary) => {
    try {
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}/runs/${run.id}`
          : `/runs/${run.id}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.");
    } catch {
      toast.error("Copy failed.");
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Generated penetration-test reports. Each completed run can be exported as PDF, Markdown, HTML, JSON, SARIF, or CSV — all rendered by the server so the download matches the live dashboard."
        actions={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-64"
            placeholder="Search reports…"
          />
        }
      />

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Ready to share</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {completed.map((r) => (
              <ReportCard key={r.id} run={r} ready onShare={() => onCopyShare(r)} />
            ))}
            {completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed reports yet.</p>
            ) : null}
          </div>

          <h2 className="mt-8 text-sm font-semibold text-muted-foreground">In progress</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inProgress.map((r) => (
              <ReportCard key={r.id} run={r} onShare={() => onCopyShare(r)} />
            ))}
            {inProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs in progress.</p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function ReportCard({
  run,
  ready,
  onShare,
}: {
  run: RunSummary;
  ready?: boolean;
  onShare: () => void;
}) {
  return (
    <Card className="h-full transition-all hover:translate-y-[-2px] hover:shadow-glow">
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2/60 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          {ready ? <Badge variant="success">Ready</Badge> : <Badge variant="primary">Live</Badge>}
        </div>
        <Link href={`/runs/${run.id}`} className="block">
          <div className="font-medium">{run.name}</div>
          <div className="truncate text-xs text-muted-foreground">{run.targets.join(", ")}</div>
        </Link>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{run.stats.vulnerabilities} findings</span>
          <span>{formatRelativeTime(run.updatedAt)}</span>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/runs/${run.id}`}>Open</Link>
          </Button>
          <ExportFormatMenu runId={run.id} runName={run.name} disabled={!ready} />
          <Button size="sm" variant="outline" onClick={onShare} title="Copy share link">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
