"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProvider } from "@/lib/api";
import type { AdminOrgRow } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

export default function AdminOrganizationsPage() {
  const [rows, setRows] = useState<AdminOrgRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getProvider()
      .listAdminOrgs()
      .then((r) => {
        if (!cancelled) {
          setRows(r);
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
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.org.name.toLowerCase().includes(needle) ||
        r.org.id.toLowerCase().includes(needle) ||
        r.org.slug.toLowerCase().includes(needle),
    );
  }, [q, rows]);

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Cross-tenant oversight. All reads are audit-logged."
        actions={
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-full pl-8"
              placeholder="Search organizations…"
            />
          </div>
        }
      />
      <Card>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_1.2fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
            <div>Organization</div>
            <div>Members</div>
            <div>Active runs</div>
            <div>Total runs</div>
            <div>Findings</div>
            <div className="text-right">Last active</div>
          </div>
          <ul>
            {loading ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">Loading…</li>
            ) : filtered.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No organizations match &quot;{q}&quot;.
              </li>
            ) : (
              filtered.map((r) => (
                <li
                  key={r.org.id}
                  className="border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface/40 md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1.2fr] md:items-center md:gap-3"
                >
                  {/* Mobile */}
                  <div className="flex flex-col gap-2 md:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.org.name}</div>
                        <div className="truncate text-[11px] font-mono text-muted-foreground">
                          {r.org.id}
                        </div>
                      </div>
                      <Badge variant={r.runsActive > 0 ? "primary" : "outline"}>
                        {r.runsActive} active
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                      <Stat label="Members" value={r.org.memberCount} />
                      <Stat label="Total runs" value={r.runsTotal} />
                      <Stat label="Findings" value={r.findingsTotal} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(r.lastActiveAt)}
                      </span>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/admin/organizations/${encodeURIComponent(r.org.id)}`}>
                          Inspect
                          <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:block">
                    <div className="text-sm font-medium">{r.org.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{r.org.id}</div>
                  </div>
                  <div className="hidden text-sm tabular-nums md:block">{r.org.memberCount}</div>
                  <div className="hidden text-sm tabular-nums md:block">
                    <Badge variant={r.runsActive > 0 ? "primary" : "outline"}>
                      {r.runsActive}
                    </Badge>
                  </div>
                  <div className="hidden text-sm tabular-nums md:block">{r.runsTotal}</div>
                  <div className="hidden text-sm tabular-nums md:block">{r.findingsTotal}</div>
                  <div className="hidden items-center justify-end gap-2 md:flex">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(r.lastActiveAt)}
                    </span>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/organizations/${encodeURIComponent(r.org.id)}`}>
                        Inspect
                        <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
