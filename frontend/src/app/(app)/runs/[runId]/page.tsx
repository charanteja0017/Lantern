"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Bug,
  CircleStop,
  Coins,
  FileText,
  ListTree,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Skull,
  Terminal,
  User as UserIcon,
  Wrench,
} from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common/status-badge";
import { SeverityBadge } from "@/components/common/severity-badge";
import { PageError, PageLoading } from "@/components/common/page-state";
import { ExportFormatMenu } from "@/components/reports/export-format-menu";
import { LlmCostCard } from "@/components/runs/llm-cost-card";
import { CommandPalette } from "@/components/runs/command-palette";
import { BlackboardPanel } from "@/components/runs/blackboard-panel";
import { useProviderData } from "@/lib/api/use-provider-data";
import { getProvider } from "@/lib/api";
import { formatCost, formatDuration, formatNumber, formatRelativeTime } from "@/lib/utils";
import type {
  AgentNode,
  ChatMessage,
  RunDetail,
  StreamEvent,
  TimelineEvent,
  ToolExecution,
} from "@/lib/types";

const ShellTabs = dynamic(
  () => import("@/components/runs/shell-tabs").then((m) => m.ShellTabs),
  { ssr: false },
);

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const rawRunId = params?.runId ?? "";
  // Guard against accidental `/runs/undefined` or `/runs/null` navigations —
  // these produced a hard 404 in the wild when callers passed an unresolved
  // run object. Treat them as a missing id and short-circuit to not-found so
  // we never send `GET /api/runs/undefined`.
  const runId =
    rawRunId && rawRunId !== "undefined" && rawRunId !== "null" ? rawRunId : "";

  const {
    data: run,
    loading,
    error,
    refetch,
    silentRefetch,
  } = useProviderData(
    (p) => (runId ? p.getRun(runId) : Promise.resolve(null)),
    [runId],
    {
      // Belt-and-braces polling for in-flight runs. The SSE stream below is
      // the primary live channel, but we also poll at a slow interval so
      // stats/agents/findings refresh even if the stream is throttled or the
      // server restarts mid-run. Poll stops automatically once the run hits
      // a terminal status (see effect below that conditionally attaches).
      pollMs: 5000,
    },
  );

  if (!runId) {
    notFound();
  }

  // Live stream — only attach when we have a run loaded and it's in an
  // in-flight status. Events are collected into a local feed shown in the
  // timeline tab.
  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>([]);
  const shouldStream =
    run?.status === "running" ||
    run?.status === "queued" ||
    run?.status === "throttled";

  // Coalesce SSE-driven refetches. Without debouncing we'd hammer
  // /api/runs/:id once per event during a noisy scan (dozens per second).
  // 400ms is fast enough to feel live and slow enough to batch bursts.
  const refetchTimer = useRef<number | null>(null);
  const scheduleSilentRefetch = useCallback(() => {
    if (refetchTimer.current !== null) {
      window.clearTimeout(refetchTimer.current);
    }
    refetchTimer.current = window.setTimeout(() => {
      refetchTimer.current = null;
      silentRefetch();
    }, 400);
  }, [silentRefetch]);

  useEffect(() => {
    if (!runId) return;
    // Reset the local buffer for the new run, then (maybe) attach the stream.
    setLiveEvents([]);
    if (!shouldStream) return;
    const controller = new AbortController();
    getProvider()
      .streamRunEvents(
        runId,
        (e: StreamEvent) => {
          setLiveEvents((prev) => [e.event, ...prev].slice(0, 500));
          // Any new event is a hint that the backend state has shifted —
          // pull the fresh aggregate so cards (stats/findings/agents/tools)
          // don't lag behind the timeline.
          scheduleSilentRefetch();
        },
        controller.signal,
      )
      .catch((err) => {
        if ((err as { name?: string } | null)?.name !== "AbortError") {
          console.warn("Run stream ended:", err);
        }
      });
    return () => {
      controller.abort();
      if (refetchTimer.current !== null) {
        window.clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
      }
    };
  }, [runId, shouldStream, scheduleSilentRefetch]);

  const [actionBusy, setActionBusy] = useState<
    "stop" | "resume" | "pause" | "kill" | "restart" | null
  >(null);
  const [vncUrl, setVncUrl] = useState<string | null>(null);
  const [vncLoadError, setVncLoadError] = useState<string | null>(null);
  const [vncFetchError, setVncFetchError] = useState<string | null>(null);
  const resolveSidechannelUrl = useCallback((rawUrl: string | null | undefined): string | null => {
    if (!rawUrl) return null;
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
    if (!apiBase) return rawUrl;
    let path = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    // Mirror ApiProvider.url(): avoid ``/api/api/...`` when the base already ends with ``/api``.
    if (/\/api$/i.test(apiBase) && path.startsWith("/api/")) {
      path = path.slice(4);
    }
    return `${apiBase}${path}`;
  }, []);
  // Fetch a fresh signed VNC URL. Re-runs whenever the run changes or while
  // the run is in-flight (the token TTL is 15 minutes, so we refresh every
  // ~10 minutes to keep the iframe alive across long scans).
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const fetchChannel = () => {
      getProvider()
        .getRunSidechannels(runId)
        .then((res) => {
          if (cancelled) return;
          const vnc = res.channels.find((c) => c.channel === "vnc");
          setVncUrl(resolveSidechannelUrl(vnc?.url));
          setVncFetchError(null);
          setVncLoadError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setVncUrl(null);
          setVncFetchError(err instanceof Error ? err.message : "Could not load live browser channel.");
        });
    };
    fetchChannel();
    // While the run is active, refresh the signed URL well before the 15-min
    // token TTL elapses so the iframe doesn't suddenly 401.
    if (!shouldStream) return undefined;
    const id = window.setInterval(fetchChannel, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [runId, resolveSidechannelUrl, shouldStream]);
  const refreshVnc = useCallback(() => {
    if (!runId) return;
    getProvider()
      .getRunSidechannels(runId)
      .then((res) => {
        const vnc = res.channels.find((c) => c.channel === "vnc");
        setVncUrl(resolveSidechannelUrl(vnc?.url));
        setVncFetchError(null);
        setVncLoadError(null);
      })
      .catch((err: unknown) => {
        setVncFetchError(err instanceof Error ? err.message : "Could not load live browser channel.");
      });
  }, [runId, resolveSidechannelUrl]);
  const stop = useCallback(async () => {
    if (!run) return;
    setActionBusy("stop");
    try {
      await getProvider().stopRun(run.id);
      toast.success("Run stop requested.");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setActionBusy(null);
    }
  }, [run, refetch]);
  const resume = useCallback(async () => {
    if (!run) return;
    setActionBusy("resume");
    try {
      await getProvider().resumeRun(run.id);
      toast.success("Run resumed.");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resume failed");
    } finally {
      setActionBusy(null);
    }
  }, [run, refetch]);
  const pause = useCallback(async () => {
    if (!run) return;
    setActionBusy("pause");
    try {
      const res = await getProvider().controlRun(run.id, "pause");
      if (res.status !== "paused") {
        throw new Error(`Pause returned status '${res.status}'`);
      }
      toast.success("Run paused.");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pause failed");
    } finally {
      setActionBusy(null);
    }
  }, [run, refetch]);
  const kill = useCallback(async () => {
    if (!run) return;
    if (!window.confirm("Hard-kill this run? No checkpoint will be saved.")) return;
    setActionBusy("kill");
    try {
      const res = await getProvider().controlRun(run.id, "kill");
      if (res.status !== "killed") {
        throw new Error(`Kill returned status '${res.status}'`);
      }
      toast.success("Run killed.");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kill failed");
    } finally {
      setActionBusy(null);
    }
  }, [run, refetch]);
  const restart = useCallback(async () => {
    if (!run) return;
    const confirmed = window.confirm(
      "Restart this run with memory context?\n\n"
        + "The new run will reuse previous context (recent commands/tools, findings, and report excerpt) "
        + "to continue from prior progress instead of starting blind.",
    );
    if (!confirmed) return;
    setActionBusy("restart");
    try {
      const res = await getProvider().controlRun(run.id, "restart");
      if (res.status !== "restarted") {
        throw new Error(`Restart returned status '${res.status}'`);
      }
      if (res.run_id && res.run_id !== run.id) {
        toast.success("Run restarted.");
        window.location.href = `/runs/${encodeURIComponent(res.run_id)}`;
        return;
      }
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setActionBusy(null);
    }
  }, [run, refetch]);

  if (loading) return <PageLoading label="Loading run…" />;
  if (error) {
    if (/not.?found|404/i.test(error.message)) notFound();
    return <PageError error={error} onRetry={refetch} />;
  }
  if (!run) notFound();

  const canStop =
    run.status === "running" || run.status === "queued" || run.status === "throttled";
  const canResume = run.status === "paused" || run.status === "stopped" || run.status === "failed";

  // Surface runner.log tail when the subprocess crashed (missing STRIX_LLM,
  // bad API key, sandbox image unreachable…). The backend emits a
  // ``run.failed`` event with the last ~4KB of ``runner.log`` in the payload
  // so users don't have to exec into the container to diagnose.
  const failureEvent = run.events?.find(
    (ev) => ev.type === "run.failed" && ev.message,
  );
  const failureMessage = failureEvent?.message ?? null;

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/runs" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to runs
        </Link>
      </div>

      <PageHeader
        title={run.name}
        description={<RunSubheader run={run} />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refetch}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            {canStop ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={pause}
                  disabled={actionBusy !== null}
                  title="Freeze the run in-place (SIGSTOP). Sandbox and sockets stay warm."
                >
                  {actionBusy === "pause" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PauseCircle className="h-4 w-4" />
                  )}
                  Pause
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={stop}
                  disabled={actionBusy !== null}
                >
                  {actionBusy === "stop" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CircleStop className="h-4 w-4" />
                  )}
                  Stop
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={kill}
                  disabled={actionBusy !== null}
                  title="Terminal SIGKILL — use only when Stop won't respond."
                  className="text-destructive hover:text-destructive"
                >
                  {actionBusy === "kill" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Skull className="h-4 w-4" />
                  )}
                  Kill
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={restart}
                  disabled={actionBusy !== null}
                  title="Start a fresh run with the same target/scan configuration and previous run memory context."
                >
                  {actionBusy === "restart" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Restart
                </Button>
              </>
            ) : null}
            {canResume ? (
              <Button size="sm" onClick={resume} disabled={actionBusy !== null}>
                {actionBusy === "resume" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                Resume
              </Button>
            ) : null}
          </div>
        }
      />
      <CommandPalette
        onCommand={async ({ command, args }) => {
          if (command === "pause") await pause();
          if (command === "resume") await resume();
          if (command === "kill") await kill();
          if (command === "restart") await restart();
          if (command === "budget") {
            const n = Number(args[0] || "");
            if (Number.isFinite(n)) {
              await getProvider().controlRun(run.id, "pause", { budgetUsd: n });
            }
          }
        }}
      />

      {run.status === "failed" && failureMessage ? (
        <Card className="border-red-400/30 bg-red-400/5">
          <CardContent className="flex items-start gap-2 p-3 text-xs text-red-200 md:p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Run failed</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-red-100/80">
                {failureMessage}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {run.throttle ? (
        <Card className="border-amber-400/30 bg-amber-400/5">
          <CardContent className="flex flex-col gap-2 p-3 text-xs text-amber-200 md:flex-row md:items-center md:justify-between md:p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                Throttled on <span className="font-medium">{run.throttle.provider}</span>
                {run.throttle.reason ? ` — ${run.throttle.reason}` : ""}.
              </div>
            </div>
            {run.throttle.retryAt ? (
              <div className="text-amber-300">
                Retry {formatRelativeTime(run.throttle.retryAt)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile icon={Bot} label="Agents" value={String(run.stats.agents)} />
        <StatTile icon={Wrench} label="Tools" value={formatNumber(run.stats.tools)} />
        <StatTile
          icon={Bug}
          label="Findings"
          value={String(run.stats.vulnerabilities)}
          tone="danger"
        />
        <StatTile
          icon={Coins}
          label="Tokens"
          value={formatNumber(run.stats.tokens)}
          subtitle={formatCost(run.stats.cost)}
        />
        <StatTile
          icon={Activity}
          label="Duration"
          value={formatDuration(run.stats.durationMs)}
          subtitle={`${run.stats.iterations} iterations`}
        />
      </div>

      <Tabs defaultValue="timeline" className="w-full">
        <div className="w-full overflow-x-auto pb-1">
          <TabsList className="inline-flex h-auto min-w-max flex-nowrap">
            <TabsTrigger value="timeline" className="shrink-0">
              <ListTree className="mr-1.5 h-3.5 w-3.5" />
              Timeline
            </TabsTrigger>
            <TabsTrigger value="agents" className="shrink-0">
              <Bot className="mr-1.5 h-3.5 w-3.5" />
              Agents ({run.agents.length})
            </TabsTrigger>
            <TabsTrigger value="findings" className="shrink-0">
              <Bug className="mr-1.5 h-3.5 w-3.5" />
              Findings ({run.findings.length})
            </TabsTrigger>
            <TabsTrigger value="tools" className="shrink-0">
              <Terminal className="mr-1.5 h-3.5 w-3.5" />
              Tools ({run.toolExecutions.length})
            </TabsTrigger>
            <TabsTrigger value="blackboard" className="shrink-0">
              <ListTree className="mr-1.5 h-3.5 w-3.5" />
              Blackboard
            </TabsTrigger>
            <TabsTrigger value="terminals" className="shrink-0">
              <Terminal className="mr-1.5 h-3.5 w-3.5" />
              Terminals
            </TabsTrigger>
            <TabsTrigger value="browser" className="shrink-0">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Live browser
            </TabsTrigger>
            <TabsTrigger value="burp" className="shrink-0">
              <Bug className="mr-1.5 h-3.5 w-3.5" />
              Burp
            </TabsTrigger>
            <TabsTrigger value="chat" className="shrink-0">
              <UserIcon className="mr-1.5 h-3.5 w-3.5" />
              Transcript
            </TabsTrigger>
            {run.reportMarkdown ? (
              <TabsTrigger value="report" className="shrink-0">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Report
              </TabsTrigger>
            ) : null}
          </TabsList>
        </div>

        <TabsContent value="timeline">
          <TimelinePanel run={run} live={liveEvents} streaming={Boolean(shouldStream)} />
        </TabsContent>

        <TabsContent value="agents">
          <div className="space-y-4">
            <LlmCostCard runId={run.id} />
            <AgentsPanel agents={run.agents} />
          </div>
        </TabsContent>

        <TabsContent value="findings">
          <FindingsPanel run={run} />
        </TabsContent>

        <TabsContent value="tools">
          <ToolsPanel tools={run.toolExecutions} />
        </TabsContent>

        <TabsContent value="blackboard">
          <BlackboardPanel runId={run.id} streaming={Boolean(shouldStream)} />
        </TabsContent>

        <TabsContent value="terminals">
          <ShellTabs runId={run.id} />
        </TabsContent>

        <TabsContent value="browser">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Live browser</CardTitle>
                <CardDescription>
                  Watch-only VNC view of the agent browser session. Available
                  while the scan is running.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={refreshVnc}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
                {vncUrl ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={vncUrl} target="_blank" rel="noopener noreferrer">
                      Open in new tab
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <LiveBrowserPanel
                runStatus={run.status}
                vncUrl={vncUrl}
                vncFetchError={vncFetchError}
                vncLoadError={vncLoadError}
                onError={() =>
                  setVncLoadError(
                    "Live browser failed to load. The sandbox container may have shut down or the signed link expired — try Refresh.",
                  )
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="burp">
          <BurpPanel runId={run.id} />
        </TabsContent>

        <TabsContent value="chat">
          <TranscriptPanel messages={run.messages} agents={run.agents} />
        </TabsContent>

        {run.reportMarkdown ? (
          <TabsContent value="report">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Report</CardTitle>
                  <CardDescription>
                    Auto-generated at the end of the run. Export as PDF, Markdown,
                    HTML, JSON, SARIF, or CSV — the server renders each format from
                    the same canonical findings bundle.
                  </CardDescription>
                </div>
                <ExportFormatMenu runId={run.id} runName={run.name} />
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-background/60 p-4 font-mono text-xs">
                  {run.reportMarkdown}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

function RunSubheader({ run }: { run: RunDetail }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge status={run.status} />
      <Badge variant="default" className="font-mono text-[11px]">
        {run.id}
      </Badge>
      <Badge variant="outline">{run.scanMode}</Badge>
      <Badge variant="outline">{run.scopeMode}</Badge>
      {run.targets.slice(0, 3).map((t) => (
        <Badge key={t} variant="default" className="font-mono text-[11px]">
          {t}
        </Badge>
      ))}
      {run.targets.length > 3 ? (
        <Badge variant="default">+{run.targets.length - 3} more</Badge>
      ) : null}
      <span className="text-xs text-muted-foreground">
        Updated {formatRelativeTime(run.updatedAt)}
      </span>
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  subtitle,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "danger";
}) {
  const toneClass = tone === "danger" ? "text-red-300" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-3 md:p-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums md:text-xl">{value}</div>
          {subtitle ? (
            <div className="text-[11px] text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        <div
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2/60 ${toneClass}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function TimelinePanel({
  run,
  live,
  streaming,
}: {
  run: RunDetail;
  live: TimelineEvent[];
  streaming: boolean;
}) {
  const combined = useMemo(() => {
    const seen = new Set<string>();
    const merged: TimelineEvent[] = [];
    for (const ev of [...live, ...run.events]) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      merged.push(ev);
    }
    return merged.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [live, run.events]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Event timeline</CardTitle>
          <CardDescription>
            Every agent, tool and finding event, newest first.
          </CardDescription>
        </div>
        {streaming ? (
          <Badge variant="primary" className="gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
            Live
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        {combined.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No events yet.
          </div>
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {combined.map((ev) => (
              <li key={ev.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-border bg-surface-2" />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{ev.type}</span>
                      {ev.actor?.agentName ? (
                        <span className="text-foreground">{ev.actor.agentName}</span>
                      ) : null}
                      {ev.severity ? <SeverityBadge severity={ev.severity} /> : null}
                    </div>
                    <div className="mt-0.5 text-sm">{ev.message}</div>
                  </div>
                  <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatRelativeTime(ev.timestamp)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function AgentsPanel({ agents }: { agents: AgentNode[] }) {
  if (agents.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No agents have spawned yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {agents.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <span className="truncate text-sm font-medium">{a.name}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{a.task}</div>
              </div>
              <Badge variant={a.status === "running" ? "primary" : "default"}>
                {a.status}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
              <StatCell label="Tools" value={a.toolExecutions} />
              <StatCell label="Findings" value={a.findings} />
              <StatCell label="Tokens" value={formatNumber(a.tokens)} />
            </div>
            {a.errorMessage ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
                {a.errorMessage}
              </div>
            ) : null}
            <div className="text-[11px] text-muted-foreground">
              Updated {formatRelativeTime(a.updatedAt)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 py-1.5">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="uppercase tracking-wider">{label}</div>
    </div>
  );
}

function FindingsPanel({ run }: { run: RunDetail }) {
  if (run.findings.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No findings yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul>
          {run.findings.map((f) => (
            <li key={f.id}>
              <Link
                href={`/findings/${f.id}`}
                className="flex flex-col gap-2 border-b border-border p-3 transition-colors last:border-b-0 hover:bg-surface-2/40 md:flex-row md:items-center md:gap-4 md:p-4"
              >
                <div className="flex items-center gap-2 md:w-28">
                  <SeverityBadge severity={f.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {f.target ?? "—"}
                    {f.endpoint ? ` · ${f.method ?? "GET"} ${f.endpoint}` : ""}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground md:text-right">
                  {formatRelativeTime(f.timestamp)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// --- Tools panel helpers ----------------------------------------------------

/** Shape of a terminal tool result after the agent wraps stdout/stderr. */
type TerminalResult = {
  content?: string;
  command?: string;
  terminal_id?: string;
  status?: string;
  exit_code?: number;
  working_dir?: string;
};

/** Try to parse ``t.output`` into a structured terminal result. Falls back
 *  to ``null`` when the output is plain text (non-terminal tools). */
function parseToolOutput(raw: string | undefined): TerminalResult | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as TerminalResult;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Pick the most sensible single-line "command" to print at the top of
 *  each tool card. Different tool types stash the command in different
 *  argument keys — ``command`` (terminal), ``code`` (python), ``url``
 *  (browser), ``query`` (web search), ``path`` (file ops), etc. */
function extractHeadline(
  toolName: string,
  args: Record<string, unknown>,
): { label: string; body: string } {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = args[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };
  const cmd = pick("command", "cmd");
  if (cmd) return { label: "$", body: cmd };
  const code = pick("code", "script");
  if (code) return { label: ">>>", body: code };
  const url = pick("url");
  if (url) return { label: toolName, body: url };
  const query = pick("query", "q");
  if (query) return { label: toolName, body: query };
  const path = pick("path", "file");
  if (path) return { label: toolName, body: path };
  // Fallback: render the whole args blob one line per key.
  const summary = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  return { label: toolName, body: summary || "(no arguments)" };
}

/** Strip the agent's injected ``[STRIX_N]$`` prompt lines when we already
 *  render the command separately — keeps output clean of redundant echoes. */
function cleanTerminalContent(content: string, command?: string): string {
  let text = content;
  // Drop leading prompt line like ``[STRIX_0]$ <command>`` if it matches
  // the command we're already displaying above.
  if (command) {
    const esc = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^\\[STRIX_\\d+\\]\\$\\s+${esc}\\n?`), "");
  } else {
    text = text.replace(/^\[STRIX_\d+\]\$\s+/, "");
  }
  // Drop trailing prompt artifact like ``\n[STRIX_0]$``.
  text = text.replace(/\n?\[STRIX_\d+\]\$\s*$/, "");
  return text;
}

function ToolsPanel({ tools }: { tools: ToolExecution[] }) {
  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No tool executions yet.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-2 p-3 md:p-4">
        {tools
          .slice()
          .sort(
            (a, b) =>
              new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
          )
          .map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
      </CardContent>
    </Card>
  );
}

function ToolCard({ tool: t }: { tool: ToolExecution }) {
  const parsed = parseToolOutput(t.output);
  const headline = extractHeadline(t.toolName, t.args);
  // When the parsed result carries its own `command`, trust that over what
  // we inferred from args — it's what the agent actually ran (after shell
  // expansion, tool rewrites, etc.).
  const displayCommand = parsed?.command ?? headline.body;
  const stdout = parsed?.content
    ? cleanTerminalContent(parsed.content, parsed.command ?? displayCommand)
    : t.output ?? "";
  const exitCode = parsed?.exit_code ?? t.exitCode;
  const workingDir = parsed?.working_dir;
  const terminalId = parsed?.terminal_id;

  const statusTone =
    t.status === "completed" && (exitCode === 0 || exitCode === undefined)
      ? "success"
      : t.status === "running"
        ? "primary"
        : "danger";

  return (
    <details className="group rounded-md border border-border bg-surface/40 open:bg-surface-2/40">
      <summary className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {t.toolName}
            </span>
            {terminalId ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {terminalId}
              </Badge>
            ) : null}
            <Badge variant={statusTone} className="ml-auto">
              {t.status}
              {exitCode !== undefined ? ` · ${exitCode}` : ""}
            </Badge>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-foreground/90">
            <span className="mr-1.5 select-none text-primary">
              {headline.label}
            </span>
            {displayCommand}
          </div>
        </div>
      </summary>

      <div className="space-y-2 border-t border-border px-3 py-2">
        <TerminalBlock
          prompt={headline.label}
          command={displayCommand}
          output={stdout}
        />

        {/* Secondary argument keys (files, flags, env) that aren't the
            primary headline. Only shown when there's something extra. */}
        {Object.keys(t.args).length > 1 ? (
          <details className="rounded border border-border/60 bg-background/40">
            <summary className="cursor-pointer px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Arguments
            </summary>
            <pre className="overflow-x-auto px-2 pb-2 font-mono text-[11px] text-foreground/80">
              {JSON.stringify(t.args, null, 2)}
            </pre>
          </details>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Started {formatRelativeTime(t.startedAt)}</span>
          {t.completedAt ? (
            <span>finished {formatRelativeTime(t.completedAt)}</span>
          ) : null}
          {workingDir ? (
            <span className="font-mono">
              cwd <span className="text-foreground/70">{workingDir}</span>
            </span>
          ) : null}
        </div>
      </div>
    </details>
  );
}

/** Mini terminal: dark slab, prompt + command on the first line, stdout
 *  below in monospace. Preserves whitespace / ANSI-free text exactly. */
function TerminalBlock({
  prompt,
  command,
  output,
}: {
  prompt: string;
  command: string;
  output: string;
}) {
  return (
    <div className="overflow-hidden rounded border border-border bg-[#0b0f14]">
      <div className="flex items-start gap-2 border-b border-white/5 px-3 py-2">
        <span className="select-none font-mono text-xs text-emerald-400">
          {prompt}
        </span>
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-emerald-100">
          {command}
        </pre>
      </div>
      {output ? (
        <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-200">
          {output}
        </pre>
      ) : (
        <div className="px-3 py-2 font-mono text-[11px] italic text-slate-500">
          (no output)
        </div>
      )}
    </div>
  );
}

/** Renders the sandbox noVNC iframe with run-status-aware fallback messaging.
 *  We deliberately render the iframe even on terminal statuses if a URL is
 *  still available, because the operator may want a final glance at the
 *  agent's last known viewport before the sandbox is torn down. */
function LiveBrowserPanel({
  runStatus,
  vncUrl,
  vncFetchError,
  vncLoadError,
  onError,
}: {
  runStatus: RunDetail["status"];
  vncUrl: string | null;
  vncFetchError: string | null;
  vncLoadError: string | null;
  onError: () => void;
}) {
  const terminal =
    runStatus === "completed" ||
    runStatus === "failed" ||
    runStatus === "stopped";

  if (vncUrl) {
    return (
      <div className="space-y-2">
        <iframe
          src={vncUrl}
          title="Live Browser"
          className="h-[560px] w-full rounded-md border border-border bg-black"
          onError={onError}
        />
        {vncLoadError ? (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            {vncLoadError}
          </div>
        ) : null}
      </div>
    );
  }

  let title: string;
  let body: string;
  if (vncFetchError) {
    title = "Live browser unavailable";
    body = vncFetchError;
  } else if (terminal) {
    title = "Run is finished — sandbox has been torn down";
    body =
      "The live browser is only available while the agent is actively scanning. " +
      "Restart the run to bring up a fresh sandbox session.";
  } else if (runStatus === "queued") {
    title = "Sandbox starting";
    body = "The agent is preparing — the live browser will appear once the first browser action runs.";
  } else {
    title = "Live browser channel not available yet";
    body = "Waiting for the sandbox to publish a noVNC port. This usually takes a few seconds after the run starts.";
  }
  return (
    <div className="rounded-md border border-border bg-surface/40 p-6 text-sm">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

function BurpPanel({ runId }: { runId: string }) {
  const [items, setItems] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProvider().getBurpHistory(runId);
      setItems(res.items || []);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Burp proxy history</CardTitle>
          <CardDescription>Burp CE and Caido can both run; agent decides per task.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => refresh()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No Burp history yet.</div>
        ) : (
          <pre className="overflow-x-auto rounded-md border border-border p-3 text-xs">
            {JSON.stringify(items, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function TranscriptPanel({
  messages,
  agents,
}: {
  messages: ChatMessage[];
  agents: AgentNode[];
}) {
  const agentMap = useMemo(() => {
    const m = new Map<string, AgentNode>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No messages yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div ref={scrollRef} className="max-h-[70vh] space-y-3 overflow-auto p-3 md:p-4">
          {messages.map((msg) => {
            const agentName = msg.agentId ? agentMap.get(msg.agentId)?.name : null;
            return (
              <div
                key={msg.id}
                className="rounded-lg border border-border bg-surface/40 p-3"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="capitalize">
                    {msg.role}
                  </Badge>
                  {agentName ? <span className="text-foreground">{agentName}</span> : null}
                  <span className="ml-auto tabular-nums">
                    {formatRelativeTime(msg.timestamp)}
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
