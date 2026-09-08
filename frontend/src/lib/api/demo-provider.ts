import type { StrixProvider, CreateRunInput, ExportFormat } from "./provider";
import type {
  AdminOrgRow,
  AuditEntry,
  DashboardOverview,
  EndpointDescriptor,
  Finding,
  LlmConfigRead,
  LlmConfigWrite,
  LlmRole,
  LlmRoutesRead,
  LlmRoutesWrite,
  LlmTestResult,
  RunLlmUsage,
  OrgSummary,
  RateLimitSnapshot,
  RunDetail,
  RunStatus,
  RunSummary,
  StreamEvent,
  SystemHealthSnapshot,
  BlackboardListResponse,
  TimelineEvent,
  WhoAmI,
} from "@/lib/types";
import {
  buildBasicDetail,
  buildDemoSystemHealth,
  demoAdminOrgs,
  demoApiEndpoints,
  demoAuditLog,
  demoFindings,
  demoOrgs,
  demoOverview,
  demoRateLimits,
  demoRuns,
  runDetailById,
} from "@/lib/demo/seed";

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class DemoProvider implements StrixProvider {
  mode = "demo" as const;

  private runs = [...demoRuns];
  private details = { ...runDetailById };

  async getDashboardOverview(): Promise<DashboardOverview> {
    await delay(80);
    return demoOverview;
  }

  async listRuns(params?: { status?: RunStatus; search?: string }): Promise<RunSummary[]> {
    await delay(80);
    const q = params?.search?.toLowerCase() ?? "";
    return this.runs.filter((r) => {
      if (params?.status && r.status !== params.status) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.targets.join(",").toLowerCase().includes(q))
        return false;
      return true;
    });
  }

  async getRun(id: string): Promise<RunDetail> {
    await delay(60);
    const cached = this.details[id];
    if (cached) return cached;
    const summary = this.runs.find((r) => r.id === id);
    if (!summary) throw new Error(`Run not found: ${id}`);
    const detail = buildBasicDetail(summary);
    this.details[id] = detail;
    return detail;
  }

  async getRunBlackboard(
    runId: string,
    params?: { limit?: number; offset?: number; kind?: string[] },
  ): Promise<BlackboardListResponse> {
    await delay(40);
    return {
      runId,
      items: [],
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
    };
  }

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    await delay(120);
    const id = `run-${Math.random().toString(36).slice(2, 8)}`;
    const iso = new Date().toISOString();
    const summary: RunSummary = {
      id,
      name: id.replace("run-", ""),
      targets: input.targets,
      status: "running",
      createdAt: iso,
      updatedAt: iso,
      scanMode: input.scanMode,
      scopeMode: input.scopeMode,
      owner: { id: "user_demo", name: "Demo User" },
      stats: {
        agents: 1,
        tools: 0,
        vulnerabilities: 0,
        tokens: 0,
        cost: 0,
        iterations: 0,
        durationMs: 0,
      },
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      lastCheckpointAt: iso,
    };
    this.runs.unshift(summary);
    return summary;
  }

  async stopRun(id: string) {
    await delay(60);
    const r = this.runs.find((x) => x.id === id);
    if (r) r.status = "stopped";
  }

  async resumeRun(id: string) {
    await delay(60);
    const r = this.runs.find((x) => x.id === id);
    if (r) r.status = "running";
  }

  async controlRun(
    id: string,
    action: "pause" | "resume" | "kill" | "restart",
    _opts?: { budgetUsd?: number | null },
  ) {
    await delay(40);
    const run = this.runs.find((x) => x.id === id);
    if (run) {
      if (action === "pause") run.status = "paused" as RunStatus;
      else if (action === "resume") run.status = "running";
      else if (action === "kill") run.status = "stopped";
      else if (action === "restart") run.status = "running";
    }
    return { status: action + "d", action, run_id: action === "restart" ? id : undefined };
  }

  async sendAgentMessage(_runId: string, _agentId: string, _content: string) {
    await delay(60);
  }

  async stopAgent(_runId: string, _agentId: string) {
    await delay(60);
  }
  async listShells(_runId: string) {
    await delay(30);
    return {
      sessions: {
        default: { is_running: true, working_dir: "/workspace" },
      },
      total_count: 1,
    };
  }
  async spawnShell(_runId: string, name?: string) {
    await delay(30);
    return { shell_id: name || "default", created: true, working_dir: "/workspace", is_running: true };
  }
  async writeShell(_runId: string, shellId: string, input: string) {
    await delay(30);
    return {
      terminal_id: shellId,
      command: input,
      content: `demo@novahunter:$ ${input}\n(simulated output)`,
      status: "completed",
      exit_code: 0,
      working_dir: "/workspace",
    };
  }
  async readShell(_runId: string, shellId: string) {
    await delay(30);
    return {
      terminal_id: shellId,
      content: "demo@novahunter:$ ",
      status: "completed",
      exit_code: 0,
      working_dir: "/workspace",
    };
  }
  async closeShell(_runId: string, shellId: string) {
    await delay(30);
    return { terminal_id: shellId, status: "closed" };
  }
  async getRunSidechannels(runId: string) {
    await delay(30);
    return {
      runId,
      channels: [
        { channel: "vnc", url: "/api/runs/demo/vnc/", expires_at: Math.floor(Date.now() / 1000) + 900 },
        { channel: "shell", url: "/ws/runs/demo/shells/default", expires_at: Math.floor(Date.now() / 1000) + 900 },
      ],
    };
  }
  async listListeners(_runId: string) {
    await delay(30);
    return {
      listeners: [{ listener_id: "nc_demo", host: "0.0.0.0", port: 45678, clients: 0, status: "listening" }],
    };
  }
  async createListener(_runId: string, port?: number) {
    await delay(30);
    return { listener_id: `nc_${Date.now().toString().slice(-6)}`, host: "0.0.0.0", port: port || 45678, status: "listening" };
  }
  async readListener(_runId: string, listenerId: string) {
    await delay(30);
    return { listener_id: listenerId, bytes: 0, content: "", status: "ok" };
  }
  async sendListener(_runId: string, listenerId: string, data: string) {
    await delay(30);
    return { listener_id: listenerId, sent_clients: 0, echoed: data, status: "ok" };
  }
  async closeListener(_runId: string, listenerId: string) {
    await delay(30);
    return { listener_id: listenerId, status: "closed" };
  }
  async getBurpHistory(runId: string) {
    await delay(40);
    return { runId, items: [] };
  }
  async listMcpGallery() {
    await delay(50);
    return { items: [{ id: "filesystem", name: "Filesystem", transport: "stdio" }] };
  }
  async listCustomMcp() {
    await delay(50);
    return { items: [] as Array<{ id: string; name: string; url: string; transport: string }> };
  }
  async addCustomMcp() {
    await delay(50);
    return { ok: true };
  }
  async listApiTokens() {
    await delay(50);
    return { items: [{ label: "demo", token_hash: "sha256:demo" }] };
  }
  async createApiToken(label: string) {
    await delay(50);
    return { label, token: `nh_pat_demo_${Math.random().toString(36).slice(2, 10)}` };
  }

  async listFindings(params?: { runId?: string; severity?: string }): Promise<Finding[]> {
    await delay(80);
    let items = demoFindings;
    if (params?.severity)
      items = items.filter((f) => f.severity === params.severity);
    return items;
  }

  async getFinding(id: string): Promise<Finding> {
    await delay(40);
    const f = demoFindings.find((x) => x.id === id);
    if (!f) throw new Error(`Finding not found: ${id}`);
    return f;
  }

  async triageFinding(
    id: string,
    status: "open" | "confirmed" | "false_positive" | "accepted_risk" | "remediated" | "retested_closed",
    note?: string,
  ) {
    await delay(60);
    const f = demoFindings.find((x) => x.id === id);
    if (f) {
      f.status = status;
      f.statusNote = note ?? "";
    }
    return { findingId: id, runId: demoRuns[0]?.id ?? "demo-run", status, note: note ?? "" };
  }

  async retestFinding(id: string) {
    await delay(60);
    return { findingId: id, runId: demoRuns[0]?.id ?? "demo-run", queued: true };
  }

  async listOrganizations(): Promise<OrgSummary[]> {
    await delay(40);
    return demoOrgs;
  }

  async listAdminOrgs(): Promise<AdminOrgRow[]> {
    await delay(40);
    return demoAdminOrgs;
  }

  async listAuditLog(_params?: { orgId?: string }): Promise<AuditEntry[]> {
    await delay(40);
    return demoAuditLog;
  }

  async getRateLimitSnapshots(): Promise<RateLimitSnapshot[]> {
    await delay(40);
    return demoRateLimits;
  }

  async getSystemHealth(): Promise<SystemHealthSnapshot> {
    await delay(60);
    return buildDemoSystemHealth();
  }

  async listApiEndpoints(): Promise<EndpointDescriptor[]> {
    await delay(30);
    return demoApiEndpoints;
  }

  async whoami(): Promise<WhoAmI | null> {
    await delay(20);
    return {
      userId: "user_demo",
      email: "demo@strix.local",
      orgId: "org_demo",
      orgSlug: "demo",
      role: "platform-admin",
      elevated: true,
    };
  }

  private demoLlmConfig: LlmConfigRead = {
    provider: "anthropic/claude-sonnet",
    model: "anthropic/claude-sonnet-4",
    api_base: "",
    reasoning_effort: "high",
    api_key_set: true,
    api_key_preview: "sk-…demo",
    perplexity_key_set: false,
    updated_at: Date.now() / 1000,
    updated_by: "demo@strix.local",
  };

  async getLlmConfig(): Promise<LlmConfigRead> {
    await delay(20);
    return this.demoLlmConfig;
  }

  async saveLlmConfig(input: LlmConfigWrite): Promise<LlmConfigRead> {
    await delay(40);
    this.demoLlmConfig = {
      ...this.demoLlmConfig,
      provider: input.provider ?? this.demoLlmConfig.provider,
      model: input.model ?? this.demoLlmConfig.model,
      api_base: input.api_base ?? this.demoLlmConfig.api_base,
      reasoning_effort: input.reasoning_effort ?? this.demoLlmConfig.reasoning_effort,
      api_key_set:
        input.api_key === undefined
          ? this.demoLlmConfig.api_key_set
          : !!input.api_key,
      perplexity_key_set:
        input.perplexity_key === undefined
          ? this.demoLlmConfig.perplexity_key_set
          : !!input.perplexity_key,
      updated_at: Date.now() / 1000,
    };
    return this.demoLlmConfig;
  }

  async testLlmConfig(): Promise<LlmTestResult> {
    await delay(400);
    return {
      ok: true,
      model: this.demoLlmConfig.model,
      latency_ms: 320,
      response_preview: "OK",
      error: null,
      provider_hint: null,
    };
  }

  private demoRoutes: LlmRoutesRead = {
    roles: (
      [
        ["default", "Baseline model for everything else", "openai/gpt-4.1-mini"],
        ["planner", "High-level planning and decomposition", "openai/gpt-4.1"],
        ["executor", "Per-turn agent actions (chattiest role)", "openai/gpt-4.1-mini"],
        ["reasoner", "Deep reasoning / chain-of-thought bursts", "openai/gpt-4.1"],
        ["reporter", "Final report synthesis", "openai/gpt-4.1"],
        ["vision", "Multimodal image analysis", "openai/gpt-4.1-mini"],
        ["memory", "Conversation compression / summaries", "openai/gpt-4.1-mini"],
        ["dedupe", "Finding deduplication checks", "openai/gpt-4.1-mini"],
      ] as const
    ).map(([role, description, model]) => ({
      role,
      description,
      spec: {
        role,
        model,
        api_base: null,
        reasoning_effort: null,
        max_tokens: null,
        temperature: null,
        budget_usd: null,
        enabled: true,
        scope: "global" as const,
      },
    })),
  };

  async listLlmRoutes(): Promise<LlmRoutesRead> {
    await delay(150);
    return this.demoRoutes;
  }

  async saveLlmRoutes(input: LlmRoutesWrite): Promise<LlmRoutesRead> {
    await delay(250);
    for (const [role, write] of Object.entries(input.routes)) {
      if (!write) continue;
      const entry = this.demoRoutes.roles.find((r) => r.role === role);
      if (!entry) continue;
      entry.spec = {
        ...entry.spec,
        model: write.model,
        api_base: write.api_base ?? null,
        reasoning_effort: write.reasoning_effort ?? null,
        max_tokens: write.max_tokens ?? null,
        temperature: write.temperature ?? null,
        budget_usd: write.budget_usd ?? null,
        enabled: write.enabled ?? true,
      };
    }
    return this.demoRoutes;
  }

  async testLlmRoute(role: LlmRole) {
    await delay(250);
    return {
      role,
      ok: true,
      model: "openai/gpt-4.1-mini",
      latency_ms: 312,
      response_preview: "OK",
      context_window: 128000,
    };
  }

  async listLlmProviders() {
    await delay(80);
    return {
      providers: [
        {
          id: "openai",
          display_name: "OpenAI",
          litellm_prefix: "openai",
          env_key: "OPENAI_API_KEY",
          default_api_base: null,
          suggested_models: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
          docs_url: "https://platform.openai.com/docs/models",
          supports: { chat: true, tools: true, vision: true, reasoning: true, streaming: true },
        },
        {
          id: "anthropic",
          display_name: "Anthropic (Claude)",
          litellm_prefix: "anthropic",
          env_key: "ANTHROPIC_API_KEY",
          default_api_base: null,
          suggested_models: ["anthropic/claude-3-5-sonnet-latest"],
          docs_url: "https://docs.anthropic.com/",
          supports: { chat: true, tools: true, vision: true, reasoning: true, streaming: true },
        },
      ],
    };
  }

  async listSecrets() {
    await delay(120);
    return { enabled: false, secrets: [] };
  }

  async putSecret(name: string, _value: string) {
    await delay(200);
    return { name, preview: "•••…•••", created_at: null, updated_at: null };
  }

  async deleteSecret(name: string) {
    await delay(200);
    return { deleted: true, name };
  }

  async getRunLlmUsage(runId: string): Promise<RunLlmUsage> {
    await delay(150);
    const sample = [
      { role: "executor", tokens: 184_320, cost_usd: 0.612, requests: 214, model: "openai/gpt-4.1-mini" },
      { role: "planner", tokens: 21_400, cost_usd: 0.214, requests: 6, model: "openai/gpt-4.1" },
      { role: "reasoner", tokens: 54_800, cost_usd: 0.548, requests: 11, model: "openai/gpt-4.1" },
      { role: "reporter", tokens: 12_600, cost_usd: 0.126, requests: 1, model: "openai/gpt-4.1" },
      { role: "memory", tokens: 7_480, cost_usd: 0.010, requests: 18, model: "openai/gpt-4.1-mini" },
      { role: "dedupe", tokens: 4_200, cost_usd: 0.004, requests: 22, model: "openai/gpt-4.1-mini" },
    ];
    return {
      run_id: runId,
      total: {
        tokens: sample.reduce((a, s) => a + s.tokens, 0),
        cost_usd: Number(sample.reduce((a, s) => a + s.cost_usd, 0).toFixed(4)),
        requests: sample.reduce((a, s) => a + s.requests, 0),
      },
      by_role: sample.map((s) => ({ ...s, budget: {} })),
    };
  }

  async deleteLlmRoute(role: LlmRole): Promise<LlmRoutesRead> {
    await delay(200);
    const entry = this.demoRoutes.roles.find((r) => r.role === role);
    if (entry) {
      entry.spec = {
        ...entry.spec,
        model: "openai/gpt-4.1-mini",
        enabled: true,
      };
    }
    return this.demoRoutes;
  }

  async streamRunEvents(
    runId: string,
    onEvent: (e: StreamEvent) => void,
    signal?: AbortSignal,
  ) {
    const lines: TimelineEvent[] = [
      {
        id: `live-${Date.now()}-1`,
        timestamp: new Date().toISOString(),
        type: "tool.execution.started",
        actor: { agentId: "agent-injection", agentName: "InjectionHunter" },
        message: "Executing terminal: sqlmap -u https://staging.acme.io/api/products?q=1 --batch",
      },
      {
        id: `live-${Date.now()}-2`,
        timestamp: new Date().toISOString(),
        type: "chat.message",
        actor: { role: "assistant", agentName: "InjectionHunter" },
        message: "Analyzing sqlmap response for confirmation…",
      },
      {
        id: `live-${Date.now()}-3`,
        timestamp: new Date().toISOString(),
        type: "tool.execution.updated",
        status: "completed",
        actor: { agentId: "agent-injection", agentName: "InjectionHunter" },
        message: "sqlmap: confirmed union-based injection on `q` parameter.",
      },
      {
        id: `live-${Date.now()}-4`,
        timestamp: new Date().toISOString(),
        type: "run.checkpoint",
        message: "Checkpoint written (iteration +1)",
      },
    ];

    for (const ev of lines) {
      if (signal?.aborted) return;
      await delay(1600);
      onEvent({ id: ev.id, runId, event: ev });
    }
  }

  async exportRun(runId: string, fmt: ExportFormat) {
    const contentTypeByFmt: Record<ExportFormat, string> = {
      md: "text/markdown; charset=utf-8",
      txt: "text/plain; charset=utf-8",
      html: "text/html; charset=utf-8",
      pdf: "application/pdf",
      json: "application/json",
      sarif: "application/sarif+json",
      csv: "text/csv; charset=utf-8",
    };
    const body =
      fmt === "json" || fmt === "sarif"
        ? JSON.stringify(
            {
              runId,
              note: "Demo mode export. Connect the API to get server-rendered reports.",
            },
            null,
            2,
          )
        : `# Demo report for ${runId}\n\nDemo mode export. Connect the API to get the server-rendered report.\n`;
    const blob = new Blob([body], { type: contentTypeByFmt[fmt] });
    return {
      blob,
      filename: `${runId}-demo-report.${fmt}`,
      contentType: contentTypeByFmt[fmt],
    };
  }
}
