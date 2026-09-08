import type {
  AdminOrgRow,
  AgentNode,
  AuditEntry,
  ChatMessage,
  DashboardOverview,
  EndpointDescriptor,
  Finding,
  OrgSummary,
  RateLimitSnapshot,
  RunDetail,
  RunSummary,
  Severity,
  SystemHealthSnapshot,
  TimelineEvent,
  ToolExecution,
} from "@/lib/types";

const nowIso = () => new Date().toISOString();
const minusMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const minusHour = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const minusDay = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export const demoOrgs: OrgSummary[] = [
  { id: "org_acme", name: "Acme Security", slug: "acme", memberCount: 14 },
  { id: "org_atlas", name: "Atlas Labs", slug: "atlas", memberCount: 7 },
  { id: "org_northstar", name: "NorthStar Bank", slug: "northstar", memberCount: 42 },
];

export const demoOwner = {
  id: "user_harsha",
  name: "Harsha S.",
  avatarUrl: "",
};

const sevCounts = (c: number, h: number, m: number, l: number, i: number) =>
  ({ critical: c, high: h, medium: m, low: l, info: i }) as Record<Severity, number>;

export const demoRuns: RunSummary[] = [
  {
    id: "run-aurora-01",
    name: "aurora-01",
    targets: ["https://staging.acme.io", "https://github.com/acme/api"],
    status: "running",
    createdAt: minusMin(42),
    updatedAt: minusMin(1),
    scanMode: "deep",
    scopeMode: "auto",
    owner: demoOwner,
    stats: {
      agents: 7,
      tools: 142,
      vulnerabilities: 6,
      tokens: 184_235,
      cost: 3.42,
      iterations: 58,
      durationMs: 41 * 60_000,
    },
    severityCounts: sevCounts(1, 2, 2, 1, 0),
    lastCheckpointAt: minusMin(1),
    throttle: null,
  },
  {
    id: "run-beacon-17",
    name: "beacon-17",
    targets: ["https://api.northstar.bank"],
    status: "throttled",
    createdAt: minusMin(120),
    updatedAt: minusMin(3),
    scanMode: "deep",
    scopeMode: "full",
    owner: demoOwner,
    stats: {
      agents: 4,
      tools: 88,
      vulnerabilities: 3,
      tokens: 92_410,
      cost: 1.78,
      iterations: 31,
      durationMs: 115 * 60_000,
    },
    severityCounts: sevCounts(0, 2, 1, 0, 0),
    lastCheckpointAt: minusMin(2),
    throttle: {
      provider: "anthropic/claude-sonnet",
      reason: "TPM ceiling reached (28.2k / 30k)",
      retryAt: minusMin(-1),
    },
  },
  {
    id: "run-helios-22",
    name: "helios-22",
    targets: ["./services/payments"],
    status: "completed",
    createdAt: minusHour(5),
    updatedAt: minusHour(4),
    finishedAt: minusHour(4),
    scanMode: "standard",
    scopeMode: "diff",
    owner: demoOwner,
    stats: {
      agents: 3,
      tools: 51,
      vulnerabilities: 4,
      tokens: 41_088,
      cost: 0.84,
      iterations: 22,
      durationMs: 58 * 60_000,
    },
    severityCounts: sevCounts(0, 1, 2, 1, 0),
    lastCheckpointAt: minusHour(4),
    throttle: null,
  },
  {
    id: "run-nova-09",
    name: "nova-09",
    targets: ["https://shop.atlas.dev"],
    status: "stopped",
    createdAt: minusDay(1),
    updatedAt: minusDay(1),
    scanMode: "quick",
    scopeMode: "auto",
    owner: demoOwner,
    stats: {
      agents: 2,
      tools: 18,
      vulnerabilities: 1,
      tokens: 14_225,
      cost: 0.22,
      iterations: 9,
      durationMs: 11 * 60_000,
    },
    severityCounts: sevCounts(0, 0, 1, 0, 0),
    lastCheckpointAt: minusDay(1),
  },
  {
    id: "run-zephyr-03",
    name: "zephyr-03",
    targets: ["192.168.1.42"],
    status: "failed",
    createdAt: minusDay(2),
    updatedAt: minusDay(2),
    scanMode: "standard",
    scopeMode: "full",
    owner: demoOwner,
    stats: {
      agents: 1,
      tools: 6,
      vulnerabilities: 0,
      tokens: 4_015,
      cost: 0.07,
      iterations: 4,
      durationMs: 3 * 60_000,
    },
    severityCounts: sevCounts(0, 0, 0, 0, 0),
    lastCheckpointAt: minusDay(2),
  },
];

export const demoFindings: Finding[] = [
  {
    id: "vuln-0001",
    title: "SQL Injection in /api/products search",
    severity: "critical",
    target: "https://staging.acme.io",
    endpoint: "/api/products",
    method: "GET",
    cvss: 9.8,
    cwe: "CWE-89",
    description:
      "The `q` parameter is concatenated directly into a SQL query, allowing full table exfiltration.",
    impact: "Attackers can read arbitrary database tables, including `users` and `api_tokens`.",
    technicalAnalysis:
      "Confirmed via boolean-based payload `q=' OR '1'='1' -- ` which altered the response set. The backend log shows raw SQL containing user input without parameterization.",
    pocDescription: "Send the following request and observe full table exfil.",
    pocScript: "curl 'https://staging.acme.io/api/products?q=%27%20OR%201%3D1--%20'",
    remediation:
      "Use parameterized queries / ORM bindings. Add input validation and least-privileged DB user for the API service.",
    timestamp: minusMin(36),
    codeLocations: [
      {
        file: "services/products/search.py",
        startLine: 42,
        endLine: 48,
        snippet:
          'cursor.execute(f"SELECT * FROM products WHERE name LIKE \'%{q}%\'")',
      },
    ],
  },
  {
    id: "vuln-0002",
    title: "Stored XSS in comment rendering",
    severity: "high",
    target: "https://staging.acme.io",
    endpoint: "/products/1/comments",
    method: "POST",
    cvss: 7.4,
    cwe: "CWE-79",
    description: "Comment field is rendered as HTML without sanitization.",
    impact: "Session hijacking and persistent account takeover for any viewer of the product page.",
    remediation: "Escape output, adopt a hardened Markdown renderer, and set a strict CSP.",
    timestamp: minusMin(28),
  },
  {
    id: "vuln-0003",
    title: "IDOR on /api/users/{id}",
    severity: "high",
    target: "https://api.northstar.bank",
    endpoint: "/api/users/{id}",
    method: "GET",
    cvss: 7.1,
    cwe: "CWE-639",
    description: "Authenticated user can read any other user's profile by incrementing the id.",
    remediation: "Enforce object-level authorization checks on every read path.",
    timestamp: minusMin(20),
  },
  {
    id: "vuln-0004",
    title: "Missing rate limit on /api/login",
    severity: "medium",
    target: "https://staging.acme.io",
    endpoint: "/api/login",
    method: "POST",
    cvss: 5.3,
    cwe: "CWE-307",
    description: "No rate limits or lockout; credential stuffing is feasible.",
    remediation: "Add per-IP and per-account rate limiting, plus exponential backoff on failures.",
    timestamp: minusMin(14),
  },
  {
    id: "vuln-0005",
    title: "Outdated dependency lodash@4.17.11 with known CVE",
    severity: "medium",
    target: "./services/payments",
    cvss: 5.8,
    cve: "CVE-2019-10744",
    description: "Prototype pollution vector via dependency chain.",
    remediation: "Upgrade to lodash>=4.17.21 and pin via lockfile.",
    timestamp: minusHour(4),
  },
  {
    id: "vuln-0006",
    title: "Verbose error messages leak stack traces",
    severity: "low",
    target: "https://staging.acme.io",
    endpoint: "/api/*",
    cvss: 3.1,
    description: "API returns full stack traces on 500 in production.",
    remediation: "Return generic error messages in production; log internally.",
    timestamp: minusMin(9),
  },
];

const aurora = demoRuns[0];

const auroraAgents: AgentNode[] = [
  {
    id: "agent-root",
    name: "StrixRoot",
    task: "Full-scope penetration test of Acme staging",
    status: "running",
    parentId: null,
    createdAt: aurora.createdAt,
    updatedAt: minusMin(1),
    toolExecutions: 42,
    findings: 2,
    tokens: 72_143,
  },
  {
    id: "agent-recon",
    name: "ReconSpecialist",
    task: "Surface mapping, directory fuzzing, tech stack identification",
    status: "completed",
    parentId: "agent-root",
    createdAt: minusMin(40),
    updatedAt: minusMin(22),
    toolExecutions: 28,
    findings: 0,
    tokens: 22_041,
  },
  {
    id: "agent-injection",
    name: "InjectionHunter",
    task: "Explore SQLi/XSS/SSRF/command injection across all endpoints",
    status: "running",
    parentId: "agent-root",
    createdAt: minusMin(22),
    updatedAt: minusMin(1),
    toolExecutions: 36,
    findings: 3,
    tokens: 41_002,
  },
  {
    id: "agent-authz",
    name: "AuthZAnalyst",
    task: "IDOR, broken authorization, JWT tampering",
    status: "waiting",
    parentId: "agent-root",
    createdAt: minusMin(16),
    updatedAt: minusMin(2),
    toolExecutions: 18,
    findings: 1,
    tokens: 19_845,
  },
  {
    id: "agent-supplychain",
    name: "SupplyChainAuditor",
    task: "Dependency CVEs, lockfile integrity, package impersonation",
    status: "completed",
    parentId: "agent-root",
    createdAt: minusMin(14),
    updatedAt: minusMin(6),
    toolExecutions: 12,
    findings: 0,
    tokens: 9_012,
  },
  {
    id: "agent-cicd",
    name: "CICDInspector",
    task: "GitHub Actions secrets, workflow injection surface",
    status: "failed",
    parentId: "agent-root",
    createdAt: minusMin(10),
    updatedAt: minusMin(4),
    toolExecutions: 4,
    findings: 0,
    tokens: 3_488,
    errorMessage: "Repo clone failed: rate limited by GitHub API",
  },
  {
    id: "agent-secret",
    name: "SecretScanner",
    task: "Secret scanning across source trees and build artifacts",
    status: "running",
    parentId: "agent-root",
    createdAt: minusMin(6),
    updatedAt: minusMin(1),
    toolExecutions: 2,
    findings: 0,
    tokens: 1_904,
  },
];

const auroraMessages: ChatMessage[] = [
  {
    id: 1,
    agentId: null,
    role: "system",
    content: "StrixAgent system initialized. Targets loaded.",
    timestamp: aurora.createdAt,
  },
  {
    id: 2,
    agentId: "agent-root",
    role: "user",
    content: "Focus on authentication, IDOR, and injection paths. Deep mode enabled.",
    timestamp: minusMin(40),
  },
  {
    id: 3,
    agentId: "agent-root",
    role: "assistant",
    content:
      "Plan: I will delegate reconnaissance, injection, authorization, supply-chain, CI/CD, and secret scanning to specialist subagents in parallel. Findings will be consolidated into a unified report.",
    timestamp: minusMin(39),
  },
  {
    id: 4,
    agentId: "agent-injection",
    role: "assistant",
    content:
      "Detected potential SQLi on /api/products via `q` parameter. Confirming with time-based payload.",
    timestamp: minusMin(36),
  },
  {
    id: 5,
    agentId: "agent-injection",
    role: "tool",
    content:
      "[terminal] curl -s 'https://staging.acme.io/api/products?q=%27%20OR%201=1--'\n=> 200 OK, 1.4MB response containing all product rows.",
    timestamp: minusMin(35),
  },
  {
    id: 6,
    agentId: "agent-injection",
    role: "assistant",
    content: "Confirmed SQLi. Creating finding with severity=critical and CVSS 9.8.",
    timestamp: minusMin(34),
  },
];

const auroraTools: ToolExecution[] = [
  {
    id: 1,
    agentId: "agent-recon",
    toolName: "terminal",
    args: { cmd: "nmap -sV staging.acme.io" },
    status: "completed",
    startedAt: minusMin(40),
    completedAt: minusMin(39),
    output:
      "Discovered: 443/tcp open (nginx 1.24), 22/tcp open (OpenSSH 9.2), 6379/tcp filtered",
    exitCode: 0,
  },
  {
    id: 2,
    agentId: "agent-recon",
    toolName: "file_search",
    args: { pattern: "README|CONTRIBUTING|.env" },
    status: "completed",
    startedAt: minusMin(39),
    completedAt: minusMin(38),
  },
  {
    id: 3,
    agentId: "agent-injection",
    toolName: "terminal",
    args: { cmd: "curl -s 'https://staging.acme.io/api/products?q=%27%20OR%201=1--'" },
    status: "completed",
    startedAt: minusMin(36),
    completedAt: minusMin(35),
    output: "200 OK — response contained full product dataset (1432 rows).",
    exitCode: 0,
  },
  {
    id: 4,
    agentId: "agent-injection",
    toolName: "create_vulnerability_report",
    args: { title: "SQL Injection in /api/products search" },
    status: "completed",
    startedAt: minusMin(35),
    completedAt: minusMin(34),
  },
  {
    id: 5,
    agentId: "agent-authz",
    toolName: "proxy",
    args: { url: "/api/users/42", replay: true },
    status: "running",
    startedAt: minusMin(3),
  },
  {
    id: 6,
    agentId: "agent-secret",
    toolName: "file_editor",
    args: { mode: "grep", pattern: "AKIA[0-9A-Z]{16}" },
    status: "running",
    startedAt: minusMin(1),
  },
];

const auroraEvents: TimelineEvent[] = [
  { id: "e1", timestamp: aurora.createdAt, type: "run.started", message: "Run started" },
  {
    id: "e2",
    timestamp: minusMin(40),
    type: "agent.created",
    actor: { agentId: "agent-recon", agentName: "ReconSpecialist" },
    message: "ReconSpecialist spawned",
  },
  {
    id: "e3",
    timestamp: minusMin(36),
    type: "finding.created",
    severity: "critical",
    actor: { agentId: "agent-injection", agentName: "InjectionHunter" },
    message: "Critical: SQL Injection in /api/products search",
  },
  {
    id: "e4",
    timestamp: minusMin(22),
    type: "agent.created",
    actor: { agentId: "agent-injection", agentName: "InjectionHunter" },
    message: "InjectionHunter spawned",
  },
  {
    id: "e5",
    timestamp: minusMin(14),
    type: "finding.created",
    severity: "medium",
    message: "Medium: Missing rate limit on /api/login",
  },
  {
    id: "e6",
    timestamp: minusMin(4),
    type: "agent.status.updated",
    status: "failed",
    actor: { agentId: "agent-cicd", agentName: "CICDInspector" },
    message: "CICDInspector failed: Repo clone rate limited",
  },
  {
    id: "e7",
    timestamp: minusMin(1),
    type: "run.checkpoint",
    message: "Checkpoint saved (iteration 58)",
  },
];

const auroraDetail: RunDetail = {
  ...aurora,
  agents: auroraAgents,
  messages: auroraMessages,
  toolExecutions: auroraTools,
  findings: demoFindings.slice(0, 4),
  events: auroraEvents,
  reportMarkdown: `# Penetration Test Report — aurora-01

## Executive Summary
A deep-scope assessment against \`staging.acme.io\` and the \`acme/api\` repository discovered **6 issues** including a **critical SQL injection** exposing the full product catalog and an authentication rate-limit gap enabling credential stuffing.

## Methodology
- Reconnaissance: port/service discovery, tech stack fingerprinting, directory fuzzing.
- Injection testing: SQLi, XSS, SSRF payloads across all discovered endpoints.
- Authorization testing: IDOR, role escalation, JWT tampering.
- Supply-chain audit: dependency CVE scan, lockfile verification.

## Technical Analysis
See findings section for detail on each issue, including PoC and remediation.

## Recommendations
- Fix the SQL injection immediately (parameterized queries) and rotate DB credentials.
- Escape all user-rendered HTML, add a strict Content-Security-Policy.
- Enforce object-level authorization on every API read path.
- Add rate limiting and lockout on authentication endpoints.
- Upgrade vulnerable dependencies and enable CI security gates.
`,
};

export const runDetailById: Record<string, RunDetail> = {
  [auroraDetail.id]: auroraDetail,
};

export function buildBasicDetail(r: RunSummary): RunDetail {
  return {
    ...r,
    agents: [
      {
        id: "agent-root",
        name: "StrixRoot",
        task: `Scan ${r.targets.join(", ")}`,
        status:
          r.status === "completed"
            ? "completed"
            : r.status === "failed"
              ? "failed"
              : r.status === "stopped"
                ? "stopped"
                : "running",
        parentId: null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        toolExecutions: r.stats.tools,
        findings: r.stats.vulnerabilities,
        tokens: r.stats.tokens,
      },
    ],
    messages: [
      {
        id: 1,
        agentId: null,
        role: "system",
        content: "Session started.",
        timestamp: r.createdAt,
      },
      {
        id: 2,
        agentId: "agent-root",
        role: "user",
        content: `Run full scan on ${r.targets.join(", ")} using ${r.scanMode} mode.`,
        timestamp: r.createdAt,
      },
    ],
    toolExecutions: [],
    findings: demoFindings.filter((f) => r.targets.some((t) => f.target?.includes(t.replace(/^https?:\/\//, "")))),
    events: [
      { id: `${r.id}-e1`, timestamp: r.createdAt, type: "run.started", message: "Run started" },
      ...(r.status === "completed"
        ? [{ id: `${r.id}-e2`, timestamp: r.updatedAt, type: "run.completed" as const, message: "Run completed" }]
        : []),
    ],
    reportMarkdown:
      r.status === "completed"
        ? `# Report ${r.name}\n\nScan completed with ${r.stats.vulnerabilities} vulnerabilities found.\n`
        : undefined,
  };
}

export const demoOverview: DashboardOverview = {
  runs: {
    active: 2,
    last24h: 3,
    weekly: [
      { day: "Mon", count: 4 },
      { day: "Tue", count: 6 },
      { day: "Wed", count: 3 },
      { day: "Thu", count: 8 },
      { day: "Fri", count: 5 },
      { day: "Sat", count: 2 },
      { day: "Sun", count: 7 },
    ],
  },
  findings: {
    total: demoFindings.length,
    bySeverity: sevCounts(1, 2, 3, 1, 0),
    weekly: [
      { day: "Mon", count: 2 },
      { day: "Tue", count: 3 },
      { day: "Wed", count: 1 },
      { day: "Thu", count: 5 },
      { day: "Fri", count: 4 },
      { day: "Sat", count: 0 },
      { day: "Sun", count: 6 },
    ],
  },
  tokens: {
    used24h: 336_973,
    cost24h: 6.33,
    hourly: Array.from({ length: 24 }).map((_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00`,
      tokens: Math.round(8000 + Math.sin(i / 2) * 6500 + Math.random() * 3000),
    })),
  },
  throttle: {
    active: true,
    providers: ["anthropic/claude-sonnet"],
    tpmUsage: 0.94,
    rpmUsage: 0.72,
  },
};

export const demoAdminOrgs: AdminOrgRow[] = demoOrgs.map((org, idx) => ({
  org,
  runsTotal: [42, 13, 128][idx] ?? 10,
  runsActive: [2, 1, 4][idx] ?? 0,
  findingsTotal: [68, 22, 311][idx] ?? 0,
  lastActiveAt: [minusMin(3), minusHour(2), minusMin(18)][idx] ?? nowIso(),
  healthScore: [92, 78, 95][idx] ?? 80,
}));

export const demoAuditLog: AuditEntry[] = [
  {
    id: "audit-1",
    actor: { id: "admin_root", name: "Admin Root", role: "platform-admin" },
    action: "admin.runs.view",
    target: "org_northstar/run-beacon-17",
    timestamp: minusMin(3),
    ip: "10.0.0.12",
  },
  {
    id: "audit-2",
    actor: { id: "admin_root", name: "Admin Root", role: "platform-admin" },
    action: "admin.audit.export",
    target: "org_acme",
    timestamp: minusMin(12),
    ip: "10.0.0.12",
  },
  {
    id: "audit-3",
    actor: { id: "user_harsha", name: "Harsha S.", role: "admin" },
    action: "run.created",
    target: "org_acme/run-aurora-01",
    timestamp: minusMin(42),
    ip: "203.0.113.5",
  },
  {
    id: "audit-4",
    actor: { id: "user_harsha", name: "Harsha S.", role: "admin" },
    action: "run.resumed",
    target: "org_acme/run-aurora-01",
    timestamp: minusHour(6),
    ip: "203.0.113.5",
  },
];

export const demoRateLimits: RateLimitSnapshot[] = [
  {
    provider: "anthropic",
    model: "claude-sonnet",
    tpm: { used: 28_240, limit: 30_000 },
    rpm: { used: 38, limit: 50 },
    queued: 4,
    retries: 2,
    status: "throttled",
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    tpm: { used: 48_000, limit: 150_000 },
    rpm: { used: 180, limit: 500 },
    queued: 0,
    retries: 0,
    status: "ok",
  },
  {
    provider: "perplexity",
    model: "pplx-search",
    tpm: { used: 2_200, limit: 10_000 },
    rpm: { used: 12, limit: 30 },
    queued: 0,
    retries: 0,
    status: "ok",
  },
];

export const demoApiEndpoints: EndpointDescriptor[] = [
  { method: "GET", path: "/healthz", name: "healthz" },
  { method: "GET", path: "/readyz", name: "readyz" },
  { method: "GET", path: "/api/dashboard/overview", name: "overview" },
  { method: "GET", path: "/api/runs", name: "list_runs" },
  { method: "POST", path: "/api/runs", name: "create_run" },
  { method: "GET", path: "/api/runs/{run_id}", name: "get_run" },
  { method: "POST", path: "/api/runs/{run_id}/stop", name: "stop_run" },
  { method: "POST", path: "/api/runs/{run_id}/resume", name: "resume_run" },
  { method: "GET", path: "/api/runs/{run_id}/stream", name: "stream_run" },
  { method: "GET", path: "/api/findings", name: "list_findings" },
  { method: "GET", path: "/api/findings/{finding_id}", name: "get_finding" },
  { method: "GET", path: "/api/orgs", name: "list_orgs" },
  { method: "GET", path: "/api/admin/orgs", name: "admin_orgs" },
  { method: "GET", path: "/api/admin/rate-limits", name: "admin_rate_limits" },
  { method: "GET", path: "/api/admin/audit", name: "admin_audit" },
  { method: "GET", path: "/api/system/health", name: "system_health" },
  { method: "GET", path: "/api/system/endpoints", name: "system_endpoints" },
];

export function buildDemoSystemHealth(): SystemHealthSnapshot {
  const now = Date.now();
  const nowIsoStr = new Date(now).toISOString();
  return {
    status: "healthy",
    generatedAt: nowIsoStr,
    process: {
      version: "0.1.0",
      environment: "demo",
      hostname: "strix-demo-1",
      python: "3.12.4 (CPython)",
      uptimeSeconds: 41_320,
      startedAt: new Date(now - 41_320_000).toISOString(),
    },
    auth: {
      enabled: false,
      issuer: "",
      jwksUrl: "",
      audience: "",
      adminEmailCount: 0,
      apiKeyCount: 0,
    },
    services: [
      {
        name: "postgres",
        status: "healthy",
        latencyMs: 3.2,
        detail: "SELECT 1 OK",
        meta: { version: "PostgreSQL 16.2" },
      },
      {
        name: "redis",
        status: "healthy",
        latencyMs: 1.1,
        detail: "PING OK",
        meta: { version: "7.2.4", mode: "standalone" },
      },
      {
        name: "runs_dir",
        status: "healthy",
        latencyMs: 0.6,
        detail: "writable",
        meta: {
          path: "/data/strix_runs",
          runCount: 18,
          disk: {
            totalBytes: 85_899_345_920,
            usedBytes: 22_800_000_000,
            freeBytes: 63_099_345_920,
            usedPercent: 26.54,
          },
        },
      },
      {
        name: "docker_socket",
        status: "healthy",
        latencyMs: null,
        detail: "/var/run/docker.sock",
        meta: { path: "/var/run/docker.sock" },
      },
      {
        name: "clerk",
        status: "disabled",
        latencyMs: null,
        detail: "Clerk not configured (demo mode)",
        meta: {},
      },
      {
        name: "frontend",
        status: "healthy",
        latencyMs: 4.8,
        detail: "/api/health OK",
        meta: { url: "http://frontend:3000/api/health" },
      },
    ],
    endpoints: demoApiEndpoints,
    metrics: [
      {
        method: "GET",
        path: "/api/runs",
        count: 84,
        errors5xx: 0,
        errors4xx: 1,
        errorRate: 0,
        latencyMsP50: 28.4,
        latencyMsP95: 112.7,
        latencyMsAvg: 41.3,
        lastSeenAt: (now - 2_000) / 1000,
      },
      {
        method: "GET",
        path: "/api/dashboard/overview",
        count: 42,
        errors5xx: 0,
        errors4xx: 0,
        errorRate: 0,
        latencyMsP50: 54.1,
        latencyMsP95: 188.9,
        latencyMsAvg: 72.6,
        lastSeenAt: (now - 6_000) / 1000,
      },
      {
        method: "GET",
        path: "/api/runs/{run_id}",
        count: 36,
        errors5xx: 0,
        errors4xx: 2,
        errorRate: 0,
        latencyMsP50: 18.7,
        latencyMsP95: 73.2,
        latencyMsAvg: 26.8,
        lastSeenAt: (now - 12_000) / 1000,
      },
      {
        method: "GET",
        path: "/api/admin/rate-limits",
        count: 22,
        errors5xx: 0,
        errors4xx: 0,
        errorRate: 0,
        latencyMsP50: 6.2,
        latencyMsP95: 14.9,
        latencyMsAvg: 7.8,
        lastSeenAt: (now - 30_000) / 1000,
      },
      {
        method: "POST",
        path: "/api/runs",
        count: 4,
        errors5xx: 0,
        errors4xx: 0,
        errorRate: 0,
        latencyMsP50: 182.3,
        latencyMsP95: 310.4,
        latencyMsAvg: 215.1,
        lastSeenAt: (now - 180_000) / 1000,
      },
    ],
    totals: {
      total: 188,
      errors5xx: 0,
      errors4xx: 3,
      errorRate: 0,
      lastSeenAt: (now - 2_000) / 1000,
    },
    rateLimits: demoRateLimits,
    activeRuns: [
      {
        run_id: "run-aurora-01",
        pid: 2412,
        started_at: (now - 7_200_000) / 1000,
        targets: ["https://aurora.acme.io"],
      },
    ],
    env: [
      { key: "STRIX_ENV", set: true, secret: false, value: "demo", preview: "" },
      { key: "STRIX_LOG_LEVEL", set: true, secret: false, value: "INFO", preview: "" },
      {
        key: "STRIX_ALLOWED_ORIGINS",
        set: true,
        secret: false,
        value: "http://localhost:3000",
        preview: "",
      },
      { key: "STRIX_RUNS_DIR", set: true, secret: false, value: "/data/strix_runs", preview: "" },
      { key: "STRIX_DATABASE_URL", set: true, secret: true, value: "", preview: "po…ix" },
      { key: "STRIX_REDIS_URL", set: true, secret: true, value: "", preview: "re…/0" },
      { key: "CLERK_ISSUER", set: false, secret: false, value: "", preview: "" },
      { key: "CLERK_JWKS_URL", set: false, secret: false, value: "", preview: "" },
      { key: "LLM_MODEL", set: true, secret: false, value: "openai/gpt-5.4", preview: "" },
      { key: "LLM_API_KEY", set: true, secret: true, value: "", preview: "sk…xy" },
    ],
  };
}
