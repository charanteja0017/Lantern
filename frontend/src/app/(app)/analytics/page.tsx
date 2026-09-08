"use client";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MiniAreaChart } from "@/components/charts/area-chart";
import { MiniBarChart } from "@/components/charts/bar-chart";
import { SeverityDonut } from "@/components/charts/severity-donut";
import { PageError, PageLoading } from "@/components/common/page-state";
import { useProviderData } from "@/lib/api/use-provider-data";

export default function AnalyticsPage() {
  const { data: overview, loading, error, refetch } = useProviderData((p) =>
    p.getDashboardOverview(),
  );

  if (loading) return <PageLoading label="Loading analytics…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!overview) return null;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Usage, findings trends, and provider consumption."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Hourly token consumption (24h)</CardTitle>
            <CardDescription>All runs, across all providers.</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniAreaChart data={overview.tokens.hourly} xKey="hour" yKey="tokens" height={260} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Findings mix</CardTitle>
          </CardHeader>
          <CardContent>
            <SeverityDonut counts={overview.findings.bySeverity} />
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Runs by day</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniBarChart data={overview.runs.weekly} xKey="day" yKey="count" height={240} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Findings by day</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniBarChart
              data={overview.findings.weekly}
              xKey="day"
              yKey="count"
              color="hsl(var(--sev-high))"
              height={240}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
