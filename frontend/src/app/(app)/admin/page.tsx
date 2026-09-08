"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, Cpu, FileClock, Gauge, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageError, PageLoading } from "@/components/common/page-state";
import { useProviderData } from "@/lib/api/use-provider-data";
import { formatRelativeTime } from "@/lib/utils";

export default function AdminHome() {
  const { data, loading, error, refetch } = useProviderData(async (p) => {
    const [orgs, audit, rates] = await Promise.all([
      p.listAdminOrgs(),
      p.listAuditLog(),
      p.getRateLimitSnapshots(),
    ]);
    return { orgs, audit, rates };
  });

  if (loading) return <PageLoading label="Loading admin console…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!data) return null;

  const { orgs, audit, rates } = data;

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant="danger" className="uppercase">
          <ShieldAlert className="h-3 w-3" /> platform-admin
        </Badge>
        <span className="text-xs text-muted-foreground">
          Every action on this page is audited and visible to the customer.
        </span>
      </div>
      <PageHeader
        title="Admin console"
        description="Oversee every customer run, rate-limit pressure, and support context — scoped by strict policy."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Link href="/admin/llm">
          <Card className="h-full transition-all hover:shadow-glow">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-emerald-300">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">LLM routing</div>
                <div className="text-xs text-muted-foreground">
                  Per-role model routing, budgets, and overrides
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/organizations">
          <Card className="h-full transition-all hover:shadow-glow">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-primary">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Organizations</div>
                <div className="text-xs text-muted-foreground">
                  {orgs.length} organizations · {orgs.reduce((a, o) => a + o.runsActive, 0)} active
                  runs
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/rate-limits">
          <Card className="h-full transition-all hover:shadow-glow">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-amber-300">
                <Gauge className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Rate limits</div>
                <div className="text-xs text-muted-foreground">
                  {rates.filter((r) => r.status !== "ok").length} providers throttled
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/audit">
          <Card className="h-full transition-all hover:shadow-glow">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2/60 text-sky-300">
                <FileClock className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Audit log</div>
                <div className="text-xs text-muted-foreground">{audit.length} recent actions</div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Most active organizations</CardTitle>
          <CardDescription>
            Ordered by active runs. Click an organization to drill down.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul>
            {[...orgs]
              .sort((a, b) => b.runsActive - a.runsActive)
              .map((row) => (
                <li
                  key={row.org.id}
                  className="border-b border-border px-4 py-3 last:border-b-0 md:grid md:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_0.8fr_0.6fr] md:items-center md:gap-3"
                >
                  {/* Mobile */}
                  <div className="flex flex-col gap-2 md:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{row.org.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {row.org.memberCount} members · {row.org.slug}
                        </div>
                      </div>
                      <Badge variant={row.healthScore > 85 ? "success" : "warning"}>
                        {row.healthScore}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        <span className="tabular-nums text-foreground">{row.runsActive}</span>{" "}
                        active
                      </span>
                      <span>
                        <span className="tabular-nums text-foreground">{row.runsTotal}</span> total
                      </span>
                      <span>
                        <span className="tabular-nums text-foreground">{row.findingsTotal}</span>{" "}
                        findings
                      </span>
                      <span>{formatRelativeTime(row.lastActiveAt)}</span>
                    </div>
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:block">
                    <div className="text-sm font-medium">{row.org.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.org.memberCount} members · {row.org.slug}
                    </div>
                  </div>
                  <div className="hidden text-sm tabular-nums md:block">
                    {row.runsActive} active
                  </div>
                  <div className="hidden text-sm tabular-nums md:block">
                    {row.runsTotal} total runs
                  </div>
                  <div className="hidden text-sm tabular-nums md:block">
                    {row.findingsTotal} findings
                  </div>
                  <div className="hidden text-xs text-muted-foreground md:block">
                    {formatRelativeTime(row.lastActiveAt)}
                  </div>
                  <div className="hidden text-right md:block">
                    <Badge variant={row.healthScore > 85 ? "success" : "warning"}>
                      {row.healthScore}
                    </Badge>
                  </div>
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
