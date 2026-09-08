"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BookOpenCheck, Play, Square } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentTree } from "./agent-tree";
import { ChatPanel } from "./chat-panel";
import { ToolStream } from "./tool-stream";
import { Timeline } from "./timeline";
import { FindingsPanel } from "./findings-panel";
import { StatusBadge } from "@/components/common/status-badge";
import { SeverityBadge } from "@/components/common/severity-badge";
import { getProvider } from "@/lib/api";
import type {
  ChatMessage,
  RunDetail,
  RunStatus,
  TimelineEvent,
  ToolExecution,
} from "@/lib/types";
import { formatCost, formatNumber, shortId } from "@/lib/utils";

export function RunLiveView({ initial }: { initial: RunDetail }) {
  const router = useRouter();
  const [run, setRun] = useState<RunDetail>(initial);
  const [events, setEvents] = useState<TimelineEvent[]>(initial.events);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    initial.agents[0]?.id ?? "",
  );
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [tools] = useState<ToolExecution[]>(initial.toolExecutions);
  const [toolFilter, setToolFilter] = useState<"all" | "agent">("all");
  const [streaming, setStreaming] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  const isLive =
    run.status === "running" || run.status === "throttled" || run.status === "paused";

  useEffect(() => {
    if (!isLive) return;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setStreaming(true);
    getProvider()
      .streamRunEvents(
        run.id,
        (e) => setEvents((prev) => [...prev, e.event]),
        ctrl.signal,
      )
      .catch(() => undefined)
      .finally(() => setStreaming(false));
    return () => ctrl.abort();
  }, [run.id, isLive]);

  const selectedAgent = useMemo(
    () => run.agents.find((a) => a.id === selectedAgentId) ?? run.agents[0],
    [run.agents, selectedAgentId],
  );

  async function stopRun() {
    try {
      await getProvider().stopRun(run.id);
      setRun({ ...run, status: "stopped" as RunStatus });
      toast.success(`Run ${run.name} stopped`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function resumeRun() {
    try {
      await getProvider().resumeRun(run.id);
      setRun({ ...run, status: "running" as RunStatus });
      toast.success(`Run ${run.name} resumed`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={run.status} />
            {run.throttle ? (
              <Badge variant="warning">
                <AlertTriangle className="h-3 w-3" />
                {run.throttle.provider}: {run.throttle.reason}
              </Badge>
            ) : null}
            <span className="text-sm text-muted-foreground">
              <span className="font-mono text-xs">{shortId(run.id)}</span> · {run.scanMode} ·{" "}
              {run.scopeMode} scope
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Metric label="Agents" value={String(run.stats.agents)} />
            <Metric label="Tools" value={String(run.stats.tools)} />
            <Metric label="Findings" value={String(run.stats.vulnerabilities)} />
            <Metric label="Tokens" value={formatNumber(run.stats.tokens)} />
            <Metric label="Cost" value={formatCost(run.stats.cost)} />
            <div className="ml-2 flex gap-2">
              {run.status === "stopped" ||
              run.status === "paused" ||
              run.status === "throttled" ? (
                <Button onClick={resumeRun}>
                  <Play className="h-4 w-4" /> Resume
                </Button>
              ) : null}
              {isLive ? (
                <Button variant="destructive" onClick={stopRun}>
                  <Square className="h-4 w-4" /> Stop run
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr_360px]">
        <Card className="h-[50vh] xl:h-[72vh]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Agent tree</CardTitle>
            <CardDescription className="text-xs">
              {streaming ? "Live · streaming events" : "Snapshot view"}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(50vh-60px)] overflow-y-auto scrollbar-thin xl:h-[calc(72vh-60px)]">
            <AgentTree
              agents={run.agents}
              selectedId={selectedAgent?.id ?? null}
              onSelect={setSelectedAgentId}
            />
          </CardContent>
        </Card>

        <Card className="flex h-[70vh] flex-col xl:h-[72vh]">
          <Tabs defaultValue="chat" className="flex h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
              <TabsList>
                <TabsTrigger value="chat">Conversation</TabsTrigger>
                <TabsTrigger value="tools">Tool stream</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>
              {selectedAgent ? (
                <div className="hidden max-w-full truncate text-xs text-muted-foreground sm:block">
                  {selectedAgent.name} · {selectedAgent.task}
                </div>
              ) : null}
            </div>
            <TabsContent value="chat" className="m-0 flex-1 overflow-hidden">
              {selectedAgent ? (
                <ChatPanel
                  runId={run.id}
                  agentId={selectedAgent.id}
                  agentName={selectedAgent.name}
                  messages={messages}
                  onUserMessage={(content) =>
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: prev.length + 1,
                        agentId: selectedAgent.id,
                        role: "user",
                        content,
                        timestamp: new Date().toISOString(),
                      },
                    ])
                  }
                  onStopAgent={() => undefined}
                />
              ) : null}
            </TabsContent>
            <TabsContent value="tools" className="m-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {toolFilter === "all"
                    ? `All commands across ${run.agents.length} agents (${tools.length} total)`
                    : `Commands from ${selectedAgent?.name ?? "agent"}`}
                </div>
                <div className="inline-flex rounded-md border border-border bg-surface/60 p-0.5 text-xs">
                  <button
                    className={`rounded-sm px-2 py-1 ${
                      toolFilter === "all" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                    }`}
                    onClick={() => setToolFilter("all")}
                  >
                    All agents
                  </button>
                  <button
                    className={`rounded-sm px-2 py-1 ${
                      toolFilter === "agent" ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                    }`}
                    disabled={!selectedAgent}
                    onClick={() => setToolFilter("agent")}
                  >
                    Selected only
                  </button>
                </div>
              </div>
              <ToolStream
                tools={
                  toolFilter === "all"
                    ? tools
                    : tools.filter((t) => t.agentId === selectedAgent?.id)
                }
                agents={run.agents}
                showAgent={toolFilter === "all"}
              />
            </TabsContent>
            <TabsContent value="report" className="m-0 flex-1 overflow-y-auto p-6 scrollbar-thin">
              {run.reportMarkdown ? (
                <article className="prose prose-invert max-w-none text-sm [&_h1]:mb-2 [&_h1]:text-lg [&_h2]:mt-6 [&_h2]:text-base">
                  {run.reportMarkdown.split("\n").map((line, i) => (
                    <p key={i} className="whitespace-pre-wrap">
                      {line}
                    </p>
                  ))}
                </article>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <BookOpenCheck className="h-8 w-8" />
                  <div className="text-sm">
                    The penetration test report will appear here once the run completes.
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        <Card className="h-[60vh] xl:h-[72vh]">
          <Tabs defaultValue="timeline" className="flex h-full flex-col">
            <div className="border-b border-border px-4 py-2">
              <TabsList>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="findings">Findings</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="timeline" className="m-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              <Timeline events={events} />
            </TabsContent>
            <TabsContent value="findings" className="m-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              <FindingsPanel findings={run.findings} />
              {run.findings.length > 0 ? (
                <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
                  {(Object.keys(run.severityCounts) as (keyof typeof run.severityCounts)[]).map(
                    (k) => (
                      <div
                        key={k}
                        className="rounded-md border border-border bg-surface/60 py-1"
                      >
                        <div className="tabular-nums">{run.severityCounts[k]}</div>
                        <SeverityBadge severity={k} className="mt-1 w-full justify-center" />
                      </div>
                    ),
                  )}
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[72px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
