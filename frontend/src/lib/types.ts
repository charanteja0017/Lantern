export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "throttled"
  | "completed"
  | "failed"
  | "stopped";

export type AgentStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "stopped"
  | "llm_failed";

export type ToolStatus = "running" | "completed" | "error" | "failed";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

export interface RunSummary {
  id: string;
  name: string;
  targets: string[];
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  scanMode: "quick" | "standard" | "deep";
  scopeMode: "auto" | "diff" | "full";
  owner: { id: string; name: string; avatarUrl?: string };
  stats: {
    agents: number;
    tools: number;
    vulnerabilities: number;
    tokens: number;
    cost: number;
    iterations: number;
    durationMs: number;
  };
  severityCounts: Record<Severity, number>;
  lastCheckpointAt?: string;
  throttle?: { provider: string; reason: string; retryAt?: string } | null;
}

export interface AgentNode {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  toolExecutions: number;
  findings: number;
  tokens: number;
  errorMessage?: string;
}

export interface ChatMessage {
  id: number;
  agentId: string | null;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecution {
  id: number;
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  startedAt: string;
  completedAt?: string;
  output?: string;
  exitCode?: number;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  target?: string;
  endpoint?: string;
  method?: string;
  cvss?: number;
  cve?: string;
  cwe?: string;
  description: string;
  impact?: string;
  technicalAnalysis?: string;
  pocDescription?: string;
  pocScript?: string;
  remediation?: string;
  status?: "open" | "confirmed" | "false_positive" | "accepted_risk" | "remediated" | "retested_closed";
  statusNote?: string;
  timestamp: string;
  codeLocations?: { file: string; startLine?: number; endLine?: number; snippet?: string }[];
}

export interface RunDetail extends RunSummary {
  agents: AgentNode[];
  messages: ChatMessage[];
  toolExecutions: ToolExecution[];
  findings: Finding[];
  reportMarkdown?: string;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type:
    | "run.started"
    | "run.configured"
    | "run.completed"
    | "run.failed"
    | "run.stopped"
    | "agent.created"
    | "agent.status.updated"
    | "tool.execution.started"
    | "tool.execution.updated"
    | "chat.message"
    | "finding.created"
    | "finding.reviewed"
    | "run.checkpoint"
    | "llm.throttled"
    | "llm.resumed"
    | "nova.finding.created"
    | "nova.finding.boosted";
  actor?: { agentId?: string; agentName?: string; role?: string };
  message: string;
  severity?: Severity;
  status?: string;
}

export interface BlackboardFindingRow {
  id: string;
  run_id: string;
  kind: string;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
  confidence: number;
  severity: number;
  pheromone: number;
  effective_pheromone: number;
  created_at: string;
  updated_at: string;
}

export interface BlackboardListResponse {
  runId: string;
  items: BlackboardFindingRow[];
  limit: number;
  offset: number;
}

export interface AdminOrgRow {
  org: OrgSummary;
  runsTotal: number;
  runsActive: number;
  findingsTotal: number;
  lastActiveAt: string;
  healthScore: number;
}

export interface AuditEntry {
  id: string;
  actor: { id: string; name: string; role: string };
  action: string;
  target: string;
  timestamp: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardOverview {
  runs: { active: number; last24h: number; weekly: { day: string; count: number }[] };
  findings: {
    total: number;
    bySeverity: Record<Severity, number>;
    weekly: { day: string; count: number }[];
  };
  tokens: { used24h: number; cost24h: number; hourly: { hour: string; tokens: number }[] };
  throttle: { active: boolean; providers: string[]; tpmUsage: number; rpmUsage: number };
}

export interface RateLimitSnapshot {
  provider: string;
  model: string;
  tpm: { used: number; limit: number };
  rpm: { used: number; limit: number };
  queued: number;
  retries: number;
  status: "ok" | "throttled" | "cooldown";
}

export interface StreamEvent {
  id: string;
  runId: string;
  event: TimelineEvent;
}

export type SystemStatus = "healthy" | "degraded" | "down" | "disabled";

export interface ServiceCheck {
  name: string;
  status: SystemStatus;
  latencyMs: number | null;
  detail: string;
  meta: Record<string, unknown>;
}

export interface EndpointMetric {
  method: string;
  path: string;
  count: number;
  errors5xx: number;
  errors4xx: number;
  errorRate: number;
  latencyMsP50: number;
  latencyMsP95: number;
  latencyMsAvg: number;
  lastSeenAt: number;
}

export interface EndpointDescriptor {
  method: string;
  path: string;
  name: string;
}

export interface EnvVarRow {
  key: string;
  set: boolean;
  secret: boolean;
  value: string;
  preview: string;
}

export interface ApiProcessInfo {
  version: string;
  environment: string;
  hostname: string;
  python: string;
  uptimeSeconds: number;
  startedAt: string;
}

export interface AuthConfigInfo {
  enabled: boolean;
  issuer: string;
  jwksUrl: string;
  audience: string;
  adminEmailCount: number;
  apiKeyCount: number;
}

export interface RuntimeTotals {
  total: number;
  errors5xx: number;
  errors4xx: number;
  errorRate: number;
  lastSeenAt: number | null;
}

export interface ActiveRunHandle {
  run_id: string;
  pid: number;
  started_at: number;
  targets: string[];
}

export interface SystemHealthSnapshot {
  status: SystemStatus;
  generatedAt: string;
  process: ApiProcessInfo;
  auth: AuthConfigInfo;
  services: ServiceCheck[];
  endpoints: EndpointDescriptor[];
  metrics: EndpointMetric[];
  totals: RuntimeTotals;
  rateLimits: RateLimitSnapshot[];
  activeRuns: ActiveRunHandle[];
  env: EnvVarRow[];
}

// Server-side view of the authenticated caller. The backend computes role
// (and possibly elevates to ``platform-admin`` via STRIX_ADMIN_EMAILS /
// STRIX_ADMIN_USER_IDS), so prefer this over Clerk's raw org_role for any
// authorization-adjacent UI like the profile badge.
export interface WhoAmI {
  userId: string;
  email: string;
  orgId: string;
  orgSlug: string;
  role: "viewer" | "analyst" | "admin" | "platform-admin";
  elevated: boolean;
}

// Persisted LLM provider configuration. The API never returns the raw
// api_key — only whether one is on file and a masked preview so operators
// can recognise it without seeing the secret.
export interface LlmConfigRead {
  provider: string;
  model: string;
  api_base: string;
  reasoning_effort: string;
  api_key_set: boolean;
  api_key_preview: string;
  perplexity_key_set: boolean;
  updated_at: number;
  updated_by: string;
  nim_plan?: "free" | "paid";
  nim_rpm_cap?: number | null;
  auto_pool?: string;
  auto_strategy?: "rules" | "hybrid";
  auto_router_model?: string;
}

// Write payload — pass ``null`` for a secret field to leave the stored
// value untouched; pass an empty string to clear it.
export interface LlmConfigWrite {
  provider?: string;
  model?: string;
  api_key?: string | null;
  api_base?: string;
  perplexity_key?: string | null;
  reasoning_effort?: string;
  nim_plan?: "free" | "paid";
  nim_rpm_cap?: number | null;
  auto_pool?: string;
  auto_strategy?: "rules" | "hybrid";
  auto_router_model?: string;
}

export interface LlmTestResult {
  ok: boolean;
  model: string;
  latency_ms: number;
  response_preview: string;
  error: string | null;
  provider_hint: string | null;
}

// LLM role router — what the admin console uses to route each agent role
// (planner/executor/reasoner/reporter/vision/memory/dedupe) to a specific
// model. The server never returns raw API keys; secrets are referenced by
// name via `api_key_ref` and resolved from the encrypted secret store.
export type LlmRole =
  | "default"
  | "planner"
  | "executor"
  | "reasoner"
  | "reporter"
  | "vision"
  | "memory"
  | "dedupe";

export interface LlmRouteSpec {
  role: LlmRole;
  model: string;
  api_base: string | null;
  reasoning_effort: string | null;
  max_tokens: number | null;
  temperature: number | null;
  budget_usd: number | null;
  enabled: boolean;
  scope: "global" | "org" | "run";
}

export interface LlmRouteEntry {
  role: LlmRole;
  description: string;
  spec: LlmRouteSpec;
}

export interface LlmRoutesRead {
  roles: LlmRouteEntry[];
}

export interface LlmRouteWrite {
  role: LlmRole;
  model: string;
  api_base?: string | null;
  api_key_ref?: string | null;
  reasoning_effort?: string | null;
  max_tokens?: number | null;
  temperature?: number | null;
  budget_usd?: number | null;
  enabled?: boolean;
}

export interface LlmRoutesWrite {
  routes: Partial<Record<LlmRole, LlmRouteWrite>>;
}

export interface LlmUsageByRole {
  role: LlmRole | string;
  tokens: number;
  cost_usd: number;
  requests: number;
  model: string;
  budget: { cost_usd?: number; tokens?: number };
}

export interface RunLlmUsage {
  run_id: string;
  total: { tokens: number; cost_usd: number; requests: number };
  by_role: LlmUsageByRole[];
}
