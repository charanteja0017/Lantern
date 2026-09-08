"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bug,
  Download,
  FileText,
  KeyRound,
  Mail,
  PauseCircle,
  PlayCircle,
  Shield,
  ShieldAlert,
  User,
  UserCog,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getProvider } from "@/lib/api";
import type { AdminOrgRow, AuditEntry, RunSummary } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  email: string;
  role: "viewer" | "analyst" | "admin" | "platform-admin";
  lastActive: string;
};

const SEED_MEMBERS: Member[] = [
  { id: "u_1", name: "Priya Iyer", email: "priya@acme.com", role: "admin", lastActive: "5m ago" },
  { id: "u_2", name: "Marcus Lee", email: "marcus@acme.com", role: "analyst", lastActive: "2h ago" },
  { id: "u_3", name: "Anaïs Dupont", email: "anais@acme.com", role: "analyst", lastActive: "1d ago" },
  { id: "u_4", name: "Devon Parker", email: "devon@acme.com", role: "viewer", lastActive: "3d ago" },
  { id: "u_5", name: "Yuki Tanaka", email: "yuki@acme.com", role: "viewer", lastActive: "6d ago" },
];

const ROLE_BADGE: Record<Member["role"], "outline" | "primary" | "warning" | "danger"> = {
  viewer: "outline",
  analyst: "primary",
  admin: "warning",
  "platform-admin": "danger",
};

export default function AdminOrgInspectPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = decodeURIComponent((params?.orgId as string) || "");
  const router = useRouter();

  const [org, setOrg] = useState<AdminOrgRow | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [members] = useState<Member[]>(SEED_MEMBERS);
  const [loading, setLoading] = useState(true);
  const [dlgOpen, setDlgOpen] = useState<null | "support" | "pause" | "email">(null);
  const [supportNote, setSupportNote] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  useEffect(() => {
    let cancelled = false;
    const provider = getProvider();
    Promise.all([
      provider.listAdminOrgs(),
      provider.listRuns(),
      provider.listAuditLog({ orgId }),
    ])
      .then(([orgs, runsList, auditList]) => {
        if (cancelled) return;
        const match = orgs.find((o) => o.org.id === orgId) ?? null;
        setOrg(match);
        setRuns(runsList.slice(0, 10));
        setAudit(auditList.slice(0, 30));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const stats = useMemo(() => {
    if (!org) return null;
    return [
      { label: "Members", value: org.org.memberCount, icon: Users },
      { label: "Active runs", value: org.runsActive, icon: Activity },
      { label: "Total runs", value: org.runsTotal, icon: PlayCircle },
      { label: "Findings", value: org.findingsTotal, icon: Bug },
      { label: "Health", value: `${org.healthScore}/100`, icon: ShieldAlert },
    ];
  }, [org]);

  const recordAudit = (action: string) => {
    const entry: AuditEntry = {
      id: `local_${Date.now()}`,
      actor: { id: "platform-admin", name: "You (platform-admin)", role: "platform-admin" },
      action,
      target: orgId,
      timestamp: new Date().toISOString(),
    };
    setAudit((prev) => [entry, ...prev]);
  };

  const onPauseRuns = () => {
    recordAudit("admin.pause_org_runs");
    toast.success(`All runs in ${org?.org.name ?? orgId} paused.`);
    setDlgOpen(null);
  };

  const onSendSupport = () => {
    if (!supportNote.trim()) return toast.error("Write a note first.");
    recordAudit("admin.support_note_created");
    toast.success("Support note attached and broadcast to admins of the org.");
    setSupportNote("");
    setDlgOpen(null);
  };

  const onEmail = () => {
    if (!emailSubject.trim() || !emailBody.trim())
      return toast.error("Subject and body are required.");
    recordAudit("admin.email_org_admins");
    toast.success(`Email sent to ${members.filter((m) => m.role === "admin").length} admin(s).`);
    setEmailSubject("");
    setEmailBody("");
    setDlgOpen(null);
  };

  const onExport = () => {
    if (!org) return;
    const payload = {
      org: org.org,
      summary: {
        runsActive: org.runsActive,
        runsTotal: org.runsTotal,
        findingsTotal: org.findingsTotal,
        healthScore: org.healthScore,
        lastActiveAt: org.lastActiveAt,
      },
      runs,
      audit,
      exportedAt: new Date().toISOString(),
      exportedBy: "platform-admin",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strix-org-${org.org.slug || org.org.id}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    recordAudit("admin.export_org_snapshot");
    toast.success("Snapshot downloaded.");
  };

  const onImpersonate = () => {
    recordAudit("admin.impersonate_view");
    toast.success(
      `Entering read-only impersonation for ${org?.org.name ?? orgId}. Every action will be logged.`,
    );
    router.push(`/dashboard?actAs=${encodeURIComponent(orgId)}`);
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Loading organization…" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Fetching…</CardContent>
        </Card>
      </>
    );
  }

  if (!org) {
    return (
      <>
        <PageHeader
          title="Organization not found"
          description={`No organization with id ${orgId} exists in this workspace.`}
        />
        <Button variant="outline" asChild>
          <Link href="/admin/organizations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to organizations
          </Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={org.org.name}
        description={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono">
              {org.org.id}
            </span>
            <span>· slug:</span>
            <span className="font-mono">{org.org.slug}</span>
            <span>·</span>
            <span>last active {formatRelativeTime(org.lastActiveAt)}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setDlgOpen("email")}>
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Email admins
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDlgOpen("support")}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Add support note
            </Button>
            <Button size="sm" variant="outline" onClick={onExport}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
            <Button size="sm" variant="outline" onClick={onImpersonate}>
              <UserCog className="mr-1.5 h-3.5 w-3.5" />
              Impersonate (read-only)
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDlgOpen("pause")}>
              <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
              Pause all runs
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats?.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="text-lg font-semibold tabular-nums">{s.value}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto scrollbar-thin md:w-auto">
          <TabsTrigger value="overview">
            <Shield className="mr-1.5 h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="mr-1.5 h-3.5 w-3.5" />
            Members
          </TabsTrigger>
          <TabsTrigger value="runs">
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Runs
          </TabsTrigger>
          <TabsTrigger value="audit">
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Audit log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Health signals</CardTitle>
                <CardDescription>
                  Computed from run volume, failure rate, finding severity and support
                  activity.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Health score">
                  <Badge
                    variant={
                      org.healthScore > 80
                        ? "success"
                        : org.healthScore > 60
                          ? "warning"
                          : "danger"
                    }
                  >
                    {org.healthScore}/100
                  </Badge>
                </Row>
                <Row label="Active incidents">
                  <span className="tabular-nums">
                    {Math.max(0, org.runsActive - 1)} · {org.runsActive > 0 ? "live" : "quiet"}
                  </span>
                </Row>
                <Row label="Plan">
                  <Badge variant="outline">Enterprise</Badge>
                </Row>
                <Row label="Retention policy">
                  <span>90 days (run artefacts) · 365 days (audit)</span>
                </Row>
                <Row label="Region">
                  <span>us-east-1</span>
                </Row>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent flags</CardTitle>
                <CardDescription>Auto-surfaced items that need attention.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Flag
                  tone="warn"
                  title="LLM throttling spike"
                  desc="Anthropic TPM usage crossed 80% twice in the last 24h."
                />
                <Flag
                  tone="ok"
                  title="All checkpoints healthy"
                  desc="No checkpoint stalls in the last 7 days."
                />
                <Flag
                  tone="warn"
                  title="3 viewer accounts dormant"
                  desc="Not signed in for 30+ days — consider rotating."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="members">
          <Card>
            <CardContent className="p-0">
              <div className="hidden grid-cols-[1.5fr_1fr_0.7fr_0.8fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
                <div>User</div>
                <div>Email</div>
                <div>Role</div>
                <div className="text-right">Last active</div>
              </div>
              {members.map((m) => (
                <div
                  key={m.id}
                  className="border-b border-border px-4 py-3 last:border-b-0 md:grid md:grid-cols-[1.5fr_1fr_0.7fr_0.8fr] md:items-center md:gap-3"
                >
                  {/* Mobile */}
                  <div className="flex flex-col gap-1.5 md:hidden">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {m.name}
                      </div>
                      <Badge variant={ROLE_BADGE[m.role]}>{m.role}</Badge>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {m.email}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Last active {m.lastActive}
                    </div>
                  </div>
                  {/* Desktop */}
                  <div className="hidden items-center gap-2 text-sm md:flex">
                    <User className="h-4 w-4 text-muted-foreground" />
                    {m.name}
                  </div>
                  <div className="hidden font-mono text-xs text-muted-foreground md:block">
                    {m.email}
                  </div>
                  <div className="hidden md:block">
                    <Badge variant={ROLE_BADGE[m.role]}>{m.role}</Badge>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground md:block">
                    {m.lastActive}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardContent className="p-0">
              <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr] items-center gap-3 border-b border-border px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground md:grid">
                <div>Run</div>
                <div>Status</div>
                <div>Targets</div>
                <div>Findings</div>
                <div className="text-right">Updated</div>
              </div>
              {runs.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No runs yet.</div>
              ) : (
                runs.map((r) => (
                  <Link
                    href={`/runs/${r.id}`}
                    key={r.id}
                    className="block border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-surface/40 md:grid md:grid-cols-[1.6fr_1fr_1fr_1fr_0.8fr] md:items-center md:gap-3"
                  >
                    {/* Mobile */}
                    <div className="flex flex-col gap-1.5 md:hidden">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {r.id}
                          </div>
                        </div>
                        <Badge variant={r.status === "running" ? "primary" : "outline"}>
                          {r.status}
                        </Badge>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.targets.join(", ")}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          <span className="tabular-nums text-foreground">
                            {r.stats.vulnerabilities}
                          </span>{" "}
                          findings
                        </span>
                        <span>{formatRelativeTime(r.updatedAt)}</span>
                      </div>
                    </div>
                    {/* Desktop */}
                    <div className="hidden md:block">
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{r.id}</div>
                    </div>
                    <div className="hidden md:block">
                      <Badge variant={r.status === "running" ? "primary" : "outline"}>
                        {r.status}
                      </Badge>
                    </div>
                    <div className="hidden truncate text-xs text-muted-foreground md:block">
                      {r.targets.join(", ")}
                    </div>
                    <div className="hidden tabular-nums md:block">{r.stats.vulnerabilities}</div>
                    <div className="hidden text-right text-xs text-muted-foreground md:block">
                      {formatRelativeTime(r.updatedAt)}
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="p-0">
              {audit.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No audit events.</div>
              ) : (
                audit.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
                  >
                    <KeyRound className="h-4 w-4 text-primary" />
                    <div className="flex-1">
                      <div>
                        <code className="font-mono text-xs">{e.action}</code>
                        <span className="ml-2 text-xs text-muted-foreground">
                          target: {e.target}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        by {e.actor.name} ({e.actor.role})
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(e.timestamp)}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Pause runs confirm */}
      <Dialog open={dlgOpen === "pause"} onOpenChange={(o) => !o && setDlgOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Pause all runs for {org.org.name}?
            </DialogTitle>
            <DialogDescription>
              Every active run in this organization will be gracefully checkpointed and paused.
              Admins can resume them from the Runs page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onPauseRuns}>
              Pause {org.runsActive} run{org.runsActive === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Support note */}
      <Dialog open={dlgOpen === "support"} onOpenChange={(o) => !o && setDlgOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add support note</DialogTitle>
            <DialogDescription>
              Visible to admins of {org.org.name} and recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={6}
            value={supportNote}
            onChange={(e) => setSupportNote(e.target.value)}
            placeholder="Context, repro steps, next actions…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(null)}>
              Cancel
            </Button>
            <Button onClick={onSendSupport}>Post note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email */}
      <Dialog open={dlgOpen === "email"} onOpenChange={(o) => !o && setDlgOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email organization admins</DialogTitle>
            <DialogDescription>
              Sent to every user with the admin role in this org.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Subject"
            />
            <Textarea
              rows={6}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Your message…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(null)}>
              Cancel
            </Button>
            <Button onClick={onEmail}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface/60 p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function Flag({ tone, title, desc }: { tone: "ok" | "warn" | "bad"; title: string; desc: string }) {
  const color =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "warn"
        ? "border-amber-400/30 bg-amber-400/5"
        : "border-red-500/30 bg-red-500/5";
  return (
    <div className={`rounded-md border ${color} p-3`}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}

// Separator reserved for future layout use.
void Separator;
