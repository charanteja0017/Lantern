export type Method = "GET" | "POST" | "DELETE";

export type Param = {
  name: string;
  in: "path" | "query" | "body" | "header";
  type: string;
  required?: boolean;
  description: string;
  example?: string;
  default?: string;
};

export type Endpoint = {
  id: string;
  method: Method;
  path: string;
  title: string;
  description: string;
  params?: Param[];
  requestBodyExample?: string;
  responseExample: string;
  notes?: string;
};

export type Group = {
  id: string;
  title: string;
  summary: string;
  endpoints: Endpoint[];
};

/* ──────────────────────────────────────────────────────────────────────────
 * Customer-safe public API surface only.
 * No admin, audit, rate-limit internals, org inspection, or user/session
 * management endpoints are documented here.
 * ──────────────────────────────────────────────────────────────────────── */

export const GROUPS: Group[] = [
  {
    id: "runs",
    title: "Runs",
    summary: "Start, monitor, stop and resume autonomous security scans.",
    endpoints: [
      {
        id: "create-run",
        method: "POST",
        path: "/v1/runs",
        title: "Create a run",
        description:
          "Start an autonomous scan against one or more targets. Returns the run object immediately; progress is streamed via the events endpoint.",
        params: [
          { name: "name", in: "body", type: "string", required: true, description: "Human-readable name for the run.", example: "Checkout API sweep" },
          { name: "targets", in: "body", type: "string[]", required: true, description: "Target URLs, API base URLs, or repository identifiers.", example: '["https://app.example.com"]' },
          { name: "scan_mode", in: "body", type: "string", description: "One of `quick`, `balanced`, `deep`.", default: "balanced" },
          { name: "scope_mode", in: "body", type: "string", description: "One of `strict`, `expanded`.", default: "strict" },
          { name: "Idempotency-Key", in: "header", type: "string", description: "Optional idempotency key to dedupe retries." },
        ],
        requestBodyExample: `{
  "name": "Checkout API sweep",
  "targets": ["https://app.example.com"],
  "scan_mode": "balanced",
  "scope_mode": "strict"
}`,
        responseExample: `{
  "id": "run_01HMX8",
  "name": "Checkout API sweep",
  "status": "queued",
  "targets": ["https://app.example.com"],
  "scan_mode": "balanced",
  "scope_mode": "strict",
  "created_at": "2026-04-20T14:20:00Z"
}`,
      },
      {
        id: "list-runs",
        method: "GET",
        path: "/v1/runs",
        title: "List runs",
        description: "Return a paginated list of runs for the authenticated workspace.",
        params: [
          { name: "status", in: "query", type: "string", description: "Filter by status: `queued`, `running`, `completed`, `failed`." },
          { name: "limit", in: "query", type: "integer", description: "1–100.", default: "25" },
          { name: "cursor", in: "query", type: "string", description: "Pagination cursor from a previous response." },
        ],
        responseExample: `{
  "data": [
    {
      "id": "run_01HMX8",
      "name": "Checkout API sweep",
      "status": "running",
      "targets": ["https://app.example.com"],
      "severity_counts": { "critical": 1, "high": 2, "medium": 4, "low": 1, "info": 0 },
      "created_at": "2026-04-20T14:20:00Z"
    }
  ],
  "next_cursor": null
}`,
      },
      {
        id: "get-run",
        method: "GET",
        path: "/v1/runs/{run_id}",
        title: "Retrieve a run",
        description: "Fetch a single run by id.",
        params: [{ name: "run_id", in: "path", type: "string", required: true, description: "The id of the run.", example: "run_01HMX8" }],
        responseExample: `{
  "id": "run_01HMX8",
  "name": "Checkout API sweep",
  "status": "running",
  "progress": 0.42,
  "agents": 6,
  "tools_executed": 142,
  "findings_count": 8,
  "tokens_used": 128430,
  "cost_usd": 2.41,
  "started_at": "2026-04-20T14:20:14Z"
}`,
      },
      {
        id: "stop-run",
        method: "POST",
        path: "/v1/runs/{run_id}/stop",
        title: "Stop a run",
        description:
          "Gracefully terminate a running scan. Checkpoints are persisted so the run can be resumed later.",
        params: [{ name: "run_id", in: "path", type: "string", required: true, description: "The id of the run.", example: "run_01HMX8" }],
        responseExample: `{ "id": "run_01HMX8", "status": "stopping" }`,
      },
      {
        id: "resume-run",
        method: "POST",
        path: "/v1/runs/{run_id}/resume",
        title: "Resume a run",
        description: "Resume a stopped or interrupted run from its last durable checkpoint.",
        params: [{ name: "run_id", in: "path", type: "string", required: true, description: "The id of the run.", example: "run_01HMX8" }],
        responseExample: `{ "id": "run_01HMX8", "status": "running", "resumed_from_checkpoint": "chk_00041" }`,
      },
      {
        id: "stream-events",
        method: "GET",
        path: "/v1/runs/{run_id}/events",
        title: "Stream run events (SSE)",
        description:
          "Server-sent events stream of tool calls, agent spawns, and findings as they happen. Keep the connection open; the server emits a `ping` every 20 seconds.",
        params: [
          { name: "run_id", in: "path", type: "string", required: true, description: "The id of the run.", example: "run_01HMX8" },
          { name: "since", in: "query", type: "integer", description: "Resume from a specific event sequence number." },
        ],
        responseExample: `event: tool_call
data: {"t":"14:21:03","agent":"recon_001","tool":"http_fetch","target":"/api/users/42"}

event: finding
data: {"id":"f_01H","severity":"high","title":"IDOR on /api/users/{id}"}

event: ping
data: {}`,
        notes: "SSE streams cannot be tested in the playground; use `curl -N` from a terminal.",
      },
    ],
  },
  {
    id: "findings",
    title: "Findings",
    summary: "Browse individual vulnerabilities with PoC and remediation guidance.",
    endpoints: [
      {
        id: "list-findings",
        method: "GET",
        path: "/v1/findings",
        title: "List findings",
        description: "List findings across runs in your workspace.",
        params: [
          { name: "run_id", in: "query", type: "string", description: "Filter by a specific run." },
          { name: "severity", in: "query", type: "string", description: "One of `critical`, `high`, `medium`, `low`, `info`." },
          { name: "status", in: "query", type: "string", description: "One of `open`, `triaged`, `resolved`, `wont_fix`." },
          { name: "limit", in: "query", type: "integer", description: "1–100.", default: "50" },
          { name: "cursor", in: "query", type: "string", description: "Pagination cursor." },
        ],
        responseExample: `{
  "data": [
    {
      "id": "fnd_01H",
      "run_id": "run_01HMX8",
      "title": "Insecure Direct Object Reference on /api/users/{id}",
      "severity": "high",
      "status": "open",
      "cwe": "CWE-639",
      "created_at": "2026-04-20T14:21:07Z"
    }
  ],
  "next_cursor": null
}`,
      },
      {
        id: "get-finding",
        method: "GET",
        path: "/v1/findings/{finding_id}",
        title: "Retrieve a finding",
        description: "Fetch the full finding payload including proof-of-concept and remediation guidance.",
        params: [{ name: "finding_id", in: "path", type: "string", required: true, description: "The id of the finding.", example: "fnd_01H" }],
        responseExample: `{
  "id": "fnd_01H",
  "run_id": "run_01HMX8",
  "title": "Insecure Direct Object Reference on /api/users/{id}",
  "severity": "high",
  "status": "open",
  "cwe": "CWE-639",
  "owasp": "A01:2021 — Broken Access Control",
  "summary": "Authenticated users can access other users' profile data by changing the path parameter.",
  "evidence": {
    "request": "GET /api/users/42 HTTP/1.1\\nAuthorization: Bearer ...",
    "response": "HTTP/1.1 200 OK\\n..."
  },
  "poc": "curl -H 'Authorization: Bearer <attacker>' https://app.example.com/api/users/42",
  "remediation": "Enforce ownership checks in the controller. Return 403 for cross-tenant access."
}`,
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    summary: "Download audit-ready PDFs for completed runs.",
    endpoints: [
      {
        id: "get-report",
        method: "GET",
        path: "/v1/runs/{run_id}/report.pdf",
        title: "Download a PDF report",
        description: "Download the branded, audit-ready PDF for a completed run.",
        params: [{ name: "run_id", in: "path", type: "string", required: true, description: "The id of the run.", example: "run_01HMX8" }],
        responseExample: `HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="run_01HMX8-report.pdf"

%PDF-1.7 ...`,
        notes: "Binary response. Download via curl with `-o` or use the dashboard.",
      },
    ],
  },
];
