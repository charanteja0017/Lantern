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
  BlackboardListResponse,
  SystemHealthSnapshot,
  WhoAmI,
} from "@/lib/types";

export interface CreateRunInput {
  targets: string[];
  instruction?: string;
  scanMode: "quick" | "standard" | "deep";
  scopeMode: "auto" | "diff" | "full";
  // Optional per-run LLM role overrides. Keyed by role name. Only the
  // `model` field is required per override; the rest fall back to global.
  llmOverrides?: Record<
    string,
    {
      model: string;
      api_base?: string | null;
      api_key_ref?: string | null;
      reasoning_effort?: string | null;
      max_tokens?: number | null;
      temperature?: number | null;
      budget_usd?: number | null;
      enabled?: boolean;
    }
  >;
}

export interface StrixProvider {
  mode: "demo" | "api";

  getDashboardOverview(): Promise<DashboardOverview>;
  listRuns(params?: { status?: RunStatus; search?: string }): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunDetail>;
  getRunBlackboard(
    runId: string,
    params?: { limit?: number; offset?: number; kind?: string[] },
  ): Promise<BlackboardListResponse>;
  createRun(input: CreateRunInput): Promise<RunSummary>;
  stopRun(id: string): Promise<void>;
  resumeRun(id: string): Promise<void>;
  controlRun(
    id: string,
    action: "pause" | "resume" | "kill" | "restart",
    opts?: { budgetUsd?: number | null },
  ): Promise<{ status: string; action: string; run_id?: string }>;
  sendAgentMessage(runId: string, agentId: string, content: string): Promise<void>;
  stopAgent(runId: string, agentId: string): Promise<void>;
  listShells(runId: string): Promise<{ sessions: Record<string, { is_running: boolean; working_dir: string }>; total_count: number }>;
  spawnShell(runId: string, name?: string): Promise<{ shell_id: string; created: boolean; working_dir?: string; is_running?: boolean }>;
  writeShell(
    runId: string,
    shellId: string,
    input: string,
    opts?: { noEnter?: boolean; timeout?: number },
  ): Promise<Record<string, unknown>>;
  readShell(runId: string, shellId: string, timeout?: number): Promise<Record<string, unknown>>;
  closeShell(runId: string, shellId: string): Promise<Record<string, unknown>>;
  getRunSidechannels(runId: string): Promise<{
    runId: string;
    channels: { channel: string; url: string; expires_at: number }[];
  }>;
  listListeners(runId: string): Promise<{ listeners: Array<{ listener_id: string; host: string; port: number; clients: number; status: string }> }>;
  createListener(runId: string, port?: number): Promise<Record<string, unknown>>;
  readListener(runId: string, listenerId: string, timeout?: number): Promise<Record<string, unknown>>;
  sendListener(runId: string, listenerId: string, data: string): Promise<Record<string, unknown>>;
  closeListener(runId: string, listenerId: string): Promise<Record<string, unknown>>;
  getBurpHistory(runId: string): Promise<{ runId: string; items: unknown[] }>;
  listMcpGallery(): Promise<{ items: Array<{ id: string; name: string; transport: string }> }>;
  listCustomMcp(): Promise<{ items: Array<{ id: string; name: string; url: string; transport: string }> }>;
  addCustomMcp(input: { id: string; name: string; url: string; transport?: string }): Promise<{ ok: boolean }>;
  listApiTokens(): Promise<{ items: Array<{ label: string; token_hash: string }> }>;
  createApiToken(label: string): Promise<{ label: string; token: string }>;

  listFindings(params?: { runId?: string; severity?: string }): Promise<Finding[]>;
  getFinding(id: string): Promise<Finding>;
  triageFinding(
    id: string,
    status: "open" | "confirmed" | "false_positive" | "accepted_risk" | "remediated" | "retested_closed",
    note?: string,
  ): Promise<{ findingId: string; runId: string; status: string; note: string }>;
  retestFinding(id: string): Promise<{ findingId: string; runId: string; queued: boolean }>;

  listOrganizations(): Promise<OrgSummary[]>;
  listAdminOrgs(): Promise<AdminOrgRow[]>;
  listAuditLog(params?: { orgId?: string }): Promise<AuditEntry[]>;

  getRateLimitSnapshots(): Promise<RateLimitSnapshot[]>;

  getSystemHealth(): Promise<SystemHealthSnapshot>;
  listApiEndpoints(): Promise<EndpointDescriptor[]>;

  // Server-authoritative caller info — used by the UI to display the real
  // backend role (which may differ from Clerk's raw org_role after admin
  // elevation). Returns null when the request is unauthenticated, so the UI
  // can gracefully fall back to local state.
  whoami(): Promise<WhoAmI | null>;

  // LLM provider configuration persisted on the server. Saving here is what
  // actually makes scans work — local-only browser state cannot reach the
  // CLI subprocess that powers runs.
  getLlmConfig(): Promise<LlmConfigRead>;
  saveLlmConfig(input: LlmConfigWrite): Promise<LlmConfigRead>;
  testLlmConfig(input?: LlmConfigWrite): Promise<LlmTestResult>;

  // Admin LLM role router: list/update/delete per-role model routes. Secrets
  // are never sent down to the client; the UI references them by name and
  // the server resolves via the encrypted secret store.
  listLlmRoutes(): Promise<LlmRoutesRead>;
  saveLlmRoutes(input: LlmRoutesWrite): Promise<LlmRoutesRead>;
  deleteLlmRoute(role: LlmRole): Promise<LlmRoutesRead>;
  testLlmRoute(role: LlmRole): Promise<{
    role: string;
    ok: boolean;
    model?: string;
    latency_ms?: number | null;
    response_preview?: string;
    error?: string;
    context_window?: number | null;
  }>;
  listLlmProviders(): Promise<{
    providers: {
      id: string;
      display_name: string;
      litellm_prefix: string;
      env_key: string;
      default_api_base: string | null;
      suggested_models: string[];
      docs_url: string | null;
      supports: Record<string, boolean>;
    }[];
  }>;
  listSecrets(): Promise<{
    enabled: boolean;
    secrets: { name: string; preview: string; created_at: string | null; updated_at: string | null }[];
  }>;
  putSecret(name: string, value: string): Promise<{
    name: string;
    preview: string;
    created_at: string | null;
    updated_at: string | null;
  }>;
  deleteSecret(name: string): Promise<{ deleted: boolean; name: string }>;

  // Per-role token + cost telemetry for a single run. Used by the run
  // detail page to render the cost breakdown card.
  getRunLlmUsage(runId: string): Promise<RunLlmUsage>;

  streamRunEvents(
    runId: string,
    onEvent: (e: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  // Server-rendered report exports. Preferred over any client-side PDF
  // generation so the download byte-for-byte matches the canonical artifact
  // the API serves at `/api/runs/{id}/report.{fmt}`.
  exportRun(
    runId: string,
    fmt: ExportFormat,
  ): Promise<{ blob: Blob; filename: string; contentType: string }>;
}

export type ExportFormat = "md" | "txt" | "html" | "pdf" | "json" | "sarif" | "csv";

export const EXPORT_FORMATS: {
  value: ExportFormat;
  label: string;
  description: string;
}[] = [
  { value: "pdf", label: "PDF", description: "Server-rendered executive + findings report (WeasyPrint)." },
  { value: "md", label: "Markdown", description: "Full report as a .md file for review and diffing." },
  { value: "html", label: "HTML", description: "Stand-alone styled HTML page." },
  { value: "txt", label: "Plain text", description: "Unstyled text for emails and tickets." },
  { value: "json", label: "JSON", description: "Structured bundle (run + findings) for tooling." },
  { value: "sarif", label: "SARIF 2.1.0", description: "Static-analysis interchange for GitHub/Defender." },
  { value: "csv", label: "CSV", description: "Findings-only table for spreadsheets." },
];
