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
  BlackboardListResponse,
  SystemHealthSnapshot,
  WhoAmI,
} from "@/lib/types";
import { getAuthToken } from "./auth-token";

/**
 * Real backend provider. Wraps the Strix FastAPI backend.
 *
 * Endpoints contract (see strix/api/routes/*):
 *  GET    /api/dashboard/overview
 *  GET    /api/runs
 *  POST   /api/runs
 *  GET    /api/runs/:id
 *  POST   /api/runs/:id/stop
 *  POST   /api/runs/:id/resume
 *  POST   /api/runs/:id/agents/:agentId/message
 *  POST   /api/runs/:id/agents/:agentId/stop
 *  GET    /api/runs/:id/stream     (SSE)
 *  GET    /api/findings
 *  GET    /api/findings/:id
 *  GET    /api/orgs
 *  GET    /api/admin/orgs
 *  GET    /api/admin/audit
 *  GET    /api/admin/rate-limits
 */
export class ApiProvider implements StrixProvider {
  mode = "api" as const;
  constructor(private baseUrl: string) {}

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/$/, "");
    let suffix = path.startsWith("/") ? path : `/${path}`;
    // Be defensive against misconfigured deployments where
    // NEXT_PUBLIC_API_BASE_URL already ends with "/api" — otherwise we end up
    // requesting `/api/api/...`. Collapse the duplicate prefix in that case.
    if (/\/api$/.test(base) && suffix.startsWith("/api/")) {
      suffix = suffix.slice(4);
    }
    return `${base}${suffix}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const auth = await this.authHeaders();
    const res = await fetch(this.url(path), {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...auth,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }

  getDashboardOverview() {
    return this.fetchJson<DashboardOverview>("/api/dashboard/overview");
  }
  listRuns(params?: { status?: RunStatus; search?: string }) {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.fetchJson<RunSummary[]>(`/api/runs${suffix}`);
  }
  getRun(id: string) {
    return this.fetchJson<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
  }
  getRunBlackboard(
    runId: string,
    params?: { limit?: number; offset?: number; kind?: string[] },
  ) {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    for (const k of params?.kind ?? []) q.append("kind", k);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.fetchJson<BlackboardListResponse>(
      `/api/runs/${encodeURIComponent(runId)}/blackboard${suffix}`,
    );
  }
  createRun(input: CreateRunInput) {
    return this.fetchJson<RunSummary>("/api/runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  async stopRun(id: string) {
    await this.fetchJson(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
  }
  async resumeRun(id: string) {
    await this.fetchJson(`/api/runs/${encodeURIComponent(id)}/resume`, { method: "POST" });
  }
  async controlRun(
    id: string,
    action: "pause" | "resume" | "kill" | "restart",
    opts?: { budgetUsd?: number | null },
  ) {
    return this.fetchJson<{ status: string; action: string; run_id?: string }>(
      `/api/runs/${encodeURIComponent(id)}/control`,
      {
        method: "POST",
        body: JSON.stringify({
          action,
          budget_usd: opts?.budgetUsd ?? undefined,
        }),
      },
    );
  }
  async sendAgentMessage(runId: string, agentId: string, content: string) {
    await this.fetchJson(
      `/api/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}/message`,
      { method: "POST", body: JSON.stringify({ content }) },
    );
  }
  async stopAgent(runId: string, agentId: string) {
    await this.fetchJson(
      `/api/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}/stop`,
      { method: "POST" },
    );
  }
  listShells(runId: string) {
    return this.fetchJson<{
      sessions: Record<string, { is_running: boolean; working_dir: string }>;
      total_count: number;
    }>(`/api/runs/${encodeURIComponent(runId)}/shells`);
  }
  spawnShell(runId: string, name?: string) {
    return this.fetchJson<{
      shell_id: string;
      created: boolean;
      working_dir?: string;
      is_running?: boolean;
    }>(`/api/runs/${encodeURIComponent(runId)}/shells`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }
  writeShell(
    runId: string,
    shellId: string,
    input: string,
    opts?: { noEnter?: boolean; timeout?: number },
  ) {
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/shells/${encodeURIComponent(shellId)}/write`,
      {
        method: "POST",
        body: JSON.stringify({
          input,
          no_enter: opts?.noEnter ?? false,
          timeout: opts?.timeout,
          is_input: true,
        }),
      },
    );
  }
  readShell(runId: string, shellId: string, timeout?: number) {
    const q = timeout != null ? `?timeout=${encodeURIComponent(String(timeout))}` : "";
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/shells/${encodeURIComponent(shellId)}/read${q}`,
    );
  }
  closeShell(runId: string, shellId: string) {
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/shells/${encodeURIComponent(shellId)}`,
      { method: "DELETE" },
    );
  }
  getRunSidechannels(runId: string) {
    return this.fetchJson<{
      runId: string;
      channels: { channel: string; url: string; expires_at: number }[];
    }>(`/api/runs/${encodeURIComponent(runId)}/sidechannels`);
  }
  listListeners(runId: string) {
    return this.fetchJson<{
      listeners: Array<{ listener_id: string; host: string; port: number; clients: number; status: string }>;
    }>(`/api/runs/${encodeURIComponent(runId)}/listeners`);
  }
  createListener(runId: string, port?: number) {
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/listeners`,
      { method: "POST", body: JSON.stringify({ port }) },
    );
  }
  readListener(runId: string, listenerId: string, timeout?: number) {
    const q = timeout != null ? `?timeout=${encodeURIComponent(String(timeout))}` : "";
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/listeners/${encodeURIComponent(listenerId)}/read${q}`,
    );
  }
  sendListener(runId: string, listenerId: string, data: string) {
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/listeners/${encodeURIComponent(listenerId)}/send`,
      { method: "POST", body: JSON.stringify({ data }) },
    );
  }
  closeListener(runId: string, listenerId: string) {
    return this.fetchJson<Record<string, unknown>>(
      `/api/runs/${encodeURIComponent(runId)}/listeners/${encodeURIComponent(listenerId)}`,
      { method: "DELETE" },
    );
  }
  getBurpHistory(runId: string) {
    return this.fetchJson<{ runId: string; items: unknown[] }>(
      `/api/runs/${encodeURIComponent(runId)}/burp/history`,
    );
  }
  listMcpGallery() {
    return this.fetchJson<{ items: Array<{ id: string; name: string; transport: string }> }>(
      "/api/mcp/gallery",
    );
  }
  listCustomMcp() {
    return this.fetchJson<{
      items: Array<{ id: string; name: string; url: string; transport: string }>;
    }>("/api/mcp/custom");
  }
  addCustomMcp(input: { id: string; name: string; url: string; transport?: string }) {
    return this.fetchJson<{ ok: boolean }>("/api/mcp/custom", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  listApiTokens() {
    return this.fetchJson<{ items: Array<{ label: string; token_hash: string }> }>(
      "/api/mcp/tokens",
    );
  }
  createApiToken(label: string) {
    return this.fetchJson<{ label: string; token: string }>("/api/mcp/tokens", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
  }
  listFindings(params?: { runId?: string; severity?: string }) {
    const q = new URLSearchParams();
    if (params?.runId) q.set("run_id", params.runId);
    if (params?.severity) q.set("severity", params.severity);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.fetchJson<Finding[]>(`/api/findings${suffix}`);
  }
  getFinding(id: string) {
    return this.fetchJson<Finding>(`/api/findings/${encodeURIComponent(id)}`);
  }
  triageFinding(
    id: string,
    status: "open" | "confirmed" | "false_positive" | "accepted_risk" | "remediated" | "retested_closed",
    note?: string,
  ) {
    return this.fetchJson<{ findingId: string; runId: string; status: string; note: string }>(
      `/api/findings/${encodeURIComponent(id)}/triage`,
      { method: "POST", body: JSON.stringify({ status, note: note ?? "" }) },
    );
  }
  retestFinding(id: string) {
    return this.fetchJson<{ findingId: string; runId: string; queued: boolean }>(
      `/api/findings/${encodeURIComponent(id)}/retest`,
      { method: "POST" },
    );
  }
  listOrganizations() {
    return this.fetchJson<OrgSummary[]>("/api/orgs");
  }
  listAdminOrgs() {
    return this.fetchJson<AdminOrgRow[]>("/api/admin/orgs");
  }
  listAuditLog(params?: { orgId?: string }) {
    const q = new URLSearchParams();
    if (params?.orgId) q.set("org_id", params.orgId);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.fetchJson<AuditEntry[]>(`/api/admin/audit${suffix}`);
  }
  getRateLimitSnapshots() {
    return this.fetchJson<RateLimitSnapshot[]>("/api/admin/rate-limits");
  }
  getSystemHealth() {
    return this.fetchJson<SystemHealthSnapshot>("/api/system/health");
  }
  listApiEndpoints() {
    return this.fetchJson<EndpointDescriptor[]>("/api/system/endpoints");
  }
  async whoami(): Promise<WhoAmI | null> {
    // Swallow 401 so the profile page can still render for unauthenticated
    // dev sessions; everything else is a real error we want to surface.
    try {
      return await this.fetchJson<WhoAmI>("/api/auth/whoami");
    } catch (err) {
      if (err instanceof Error && /API 401/.test(err.message)) return null;
      throw err;
    }
  }

  async getLlmConfig(): Promise<LlmConfigRead> {
    return this.fetchJson<LlmConfigRead>("/api/llm/config");
  }

  async saveLlmConfig(input: LlmConfigWrite): Promise<LlmConfigRead> {
    return this.fetchJson<LlmConfigRead>("/api/llm/config", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  async testLlmConfig(input?: LlmConfigWrite): Promise<LlmTestResult> {
    return this.fetchJson<LlmTestResult>("/api/llm/test", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
  }

  listLlmRoutes(): Promise<LlmRoutesRead> {
    return this.fetchJson<LlmRoutesRead>("/api/admin/llm/routes");
  }

  saveLlmRoutes(input: LlmRoutesWrite): Promise<LlmRoutesRead> {
    return this.fetchJson<LlmRoutesRead>("/api/admin/llm/routes", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteLlmRoute(role: LlmRole): Promise<LlmRoutesRead> {
    return this.fetchJson<LlmRoutesRead>(
      `/api/admin/llm/routes/${encodeURIComponent(role)}`,
      { method: "DELETE" },
    );
  }

  getRunLlmUsage(runId: string): Promise<RunLlmUsage> {
    return this.fetchJson<RunLlmUsage>(
      `/api/runs/${encodeURIComponent(runId)}/llm/usage`,
    );
  }

  testLlmRoute(role: LlmRole) {
    return this.fetchJson<{
      role: string;
      ok: boolean;
      model?: string;
      latency_ms?: number | null;
      response_preview?: string;
      error?: string;
      context_window?: number | null;
    }>(`/api/admin/llm/routes/${encodeURIComponent(role)}/test`, { method: "POST" });
  }

  listLlmProviders() {
    return this.fetchJson<{
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
    }>("/api/admin/llm/providers");
  }

  listSecrets() {
    return this.fetchJson<{
      enabled: boolean;
      secrets: { name: string; preview: string; created_at: string | null; updated_at: string | null }[];
    }>("/api/admin/secrets");
  }

  putSecret(name: string, value: string) {
    return this.fetchJson<{
      name: string;
      preview: string;
      created_at: string | null;
      updated_at: string | null;
    }>("/api/admin/secrets", {
      method: "PUT",
      body: JSON.stringify({ name, value }),
    });
  }

  deleteSecret(name: string) {
    return this.fetchJson<{ deleted: boolean; name: string }>(
      `/api/admin/secrets/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
  }

  async streamRunEvents(
    runId: string,
    onEvent: (e: StreamEvent) => void,
    signal?: AbortSignal,
  ) {
    const auth = await this.authHeaders();
    const response = await fetch(this.url(`/api/runs/${encodeURIComponent(runId)}/stream`), {
      credentials: "include",
      signal,
      headers: { accept: "text/event-stream", ...auth },
    });
    if (!response.body) throw new Error("Stream body unavailable");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
            onEvent(parsed);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async exportRun(runId: string, fmt: ExportFormat) {
    const auth = await this.authHeaders();
    const response = await fetch(
      this.url(`/api/runs/${encodeURIComponent(runId)}/report.${fmt}`),
      {
        credentials: "include",
        headers: { accept: "*/*", ...auth },
      },
    );
    if (response.status === 501) {
      // Server signals PDF renderer missing; surface the message verbatim.
      const reason = await response.text().catch(() => "");
      throw new Error(reason || "PDF renderer unavailable on the server");
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Export ${fmt} failed (${response.status}): ${text || response.statusText}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename="([^";]+)"/.exec(disposition);
    const filename = match?.[1] ?? `${runId}-report.${fmt}`;
    const contentType = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
    return { blob, filename, contentType };
  }
}
