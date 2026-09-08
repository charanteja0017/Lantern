"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProvider } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getProvider()
      .listAuditLog()
      .then((e) => {
        if (!cancelled) {
          setEntries(e);
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
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.actor.name.toLowerCase().includes(needle) ||
        e.actor.role.toLowerCase().includes(needle) ||
        e.action.toLowerCase().includes(needle) ||
        e.target.toLowerCase().includes(needle) ||
        (e.ip ?? "").toLowerCase().includes(needle),
    );
  }, [q, entries]);

  const exportCsv = () => {
    const head = ["id", "timestamp", "actor_name", "actor_role", "action", "target", "ip"];
    const rows = filtered.map((e) => [
      e.id,
      e.timestamp,
      e.actor.name,
      e.actor.role,
      e.action,
      e.target,
      e.ip ?? "",
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strix-audit-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} rows.`);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Immutable trail of every admin action. Exports are also audited."
        actions={
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-9 w-full pl-8"
                placeholder="Search actor, action, target…"
              />
            </div>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[1.5fr_1fr_1.5fr_0.8fr_0.8fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
            <div>Actor</div>
            <div>Action</div>
            <div>Target</div>
            <div>IP</div>
            <div className="text-right">When</div>
          </div>
          <ul>
            {loading ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">Loading…</li>
            ) : filtered.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No entries match &quot;{q}&quot;.
              </li>
            ) : (
              filtered.map((e) => (
                <li
                  key={e.id}
                  className="border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface/40 md:grid md:grid-cols-[1.5fr_1fr_1.5fr_0.8fr_0.8fr] md:items-center md:gap-3"
                >
                  {/* Mobile */}
                  <div className="flex flex-col gap-1.5 md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{e.actor.name}</div>
                      <Badge variant="outline">{e.actor.role}</Badge>
                    </div>
                    <div className="break-all font-mono text-xs">{e.action}</div>
                    <div className="break-all font-mono text-[11px] text-muted-foreground">
                      {e.target}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-mono">{e.ip ?? "—"}</span>
                      <span>{new Date(e.timestamp).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:block">
                    <div className="text-sm font-medium">{e.actor.name}</div>
                    <Badge variant="outline" className="mt-1">
                      {e.actor.role}
                    </Badge>
                  </div>
                  <div className="hidden font-mono text-xs md:block">{e.action}</div>
                  <div className="hidden truncate font-mono text-xs text-muted-foreground md:block">
                    {e.target}
                  </div>
                  <div className="hidden font-mono text-xs text-muted-foreground md:block">
                    {e.ip ?? "—"}
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground md:block">
                    {new Date(e.timestamp).toLocaleString()}
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
