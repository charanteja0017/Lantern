"""Pydantic schemas for the Strix dashboard API.

These mirror the TypeScript types in ``frontend/src/lib/types.ts``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


Severity = Literal["critical", "high", "medium", "low", "info"]
RunStatus = Literal["queued", "running", "paused", "throttled", "completed", "failed", "stopped"]
AgentStatus = Literal["running", "waiting", "completed", "failed", "stopped", "llm_failed"]
ToolStatus = Literal["running", "completed", "error", "failed"]
ScanMode = Literal["quick", "standard", "deep"]
ScopeMode = Literal["auto", "diff", "full"]


class Owner(BaseModel):
    id: str
    name: str
    avatar_url: str | None = Field(default=None, alias="avatarUrl")

    model_config = {"populate_by_name": True}


class RunStats(BaseModel):
    agents: int = 0
    tools: int = 0
    vulnerabilities: int = 0
    tokens: int = 0
    cost: float = 0.0
    iterations: int = 0
    duration_ms: int = Field(default=0, alias="durationMs")

    model_config = {"populate_by_name": True}


class SeverityCounts(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    info: int = 0


class ThrottleState(BaseModel):
    provider: str
    reason: str
    retry_at: str | None = Field(default=None, alias="retryAt")

    model_config = {"populate_by_name": True}


class RunSummary(BaseModel):
    id: str
    name: str
    targets: list[str]
    status: RunStatus
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")
    scan_mode: ScanMode = Field(alias="scanMode")
    scope_mode: ScopeMode = Field(alias="scopeMode")
    owner: Owner
    stats: RunStats
    severity_counts: SeverityCounts = Field(alias="severityCounts")
    last_checkpoint_at: str | None = Field(default=None, alias="lastCheckpointAt")
    throttle: ThrottleState | None = None

    model_config = {"populate_by_name": True}


class AgentNode(BaseModel):
    id: str
    name: str
    task: str
    status: AgentStatus
    parent_id: str | None = Field(default=None, alias="parentId")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    tool_executions: int = Field(default=0, alias="toolExecutions")
    findings: int = 0
    tokens: int = 0
    error_message: str | None = Field(default=None, alias="errorMessage")

    model_config = {"populate_by_name": True}


class ChatMessage(BaseModel):
    id: int
    agent_id: str | None = Field(default=None, alias="agentId")
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    timestamp: str
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class ToolExecution(BaseModel):
    id: int
    agent_id: str = Field(alias="agentId")
    tool_name: str = Field(alias="toolName")
    args: dict[str, Any] = Field(default_factory=dict)
    status: ToolStatus
    started_at: str = Field(alias="startedAt")
    completed_at: str | None = Field(default=None, alias="completedAt")
    output: str | None = None
    exit_code: int | None = Field(default=None, alias="exitCode")

    model_config = {"populate_by_name": True}


class CodeLocation(BaseModel):
    file: str
    start_line: int | None = Field(default=None, alias="startLine")
    end_line: int | None = Field(default=None, alias="endLine")
    snippet: str | None = None

    model_config = {"populate_by_name": True}


class Finding(BaseModel):
    id: str
    title: str
    severity: Severity
    target: str | None = None
    endpoint: str | None = None
    method: str | None = None
    cvss: float | None = None
    cve: str | None = None
    cwe: str | None = None
    description: str = ""
    impact: str | None = None
    technical_analysis: str | None = Field(default=None, alias="technicalAnalysis")
    poc_description: str | None = Field(default=None, alias="pocDescription")
    poc_script: str | None = Field(default=None, alias="pocScript")
    remediation: str | None = None
    status: Literal[
        "open",
        "confirmed",
        "false_positive",
        "accepted_risk",
        "remediated",
        "retested_closed",
    ] = "open"
    status_note: str | None = Field(default=None, alias="statusNote")
    timestamp: str
    code_locations: list[CodeLocation] | None = Field(default=None, alias="codeLocations")

    model_config = {"populate_by_name": True}


class TimelineEvent(BaseModel):
    id: str
    timestamp: str
    type: str
    actor: dict[str, Any] | None = None
    message: str
    severity: Severity | None = None
    status: str | None = None


class RunDetail(RunSummary):
    agents: list[AgentNode] = Field(default_factory=list)
    messages: list[ChatMessage] = Field(default_factory=list)
    tool_executions: list[ToolExecution] = Field(default_factory=list, alias="toolExecutions")
    findings: list[Finding] = Field(default_factory=list)
    report_markdown: str | None = Field(default=None, alias="reportMarkdown")
    events: list[TimelineEvent] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class CreateRunRequest(BaseModel):
    targets: list[str]
    instruction: str | None = None
    scan_mode: ScanMode = Field(default="deep", alias="scanMode")
    scope_mode: ScopeMode = Field(default="auto", alias="scopeMode")
    # Optional per-run policy overrides; merged on top of the process-wide
    # defaults produced by :class:`strix.api.services.policy.RunPolicy`.
    # See ``RunPolicy.merge`` for the supported keys.
    policy: dict[str, Any] | None = None
    # Optional per-run LLM role router overrides. Keyed by role
    # (``planner``/``executor``/``reasoner``/``reporter``/``vision``/
    # ``memory``/``dedupe``/``default``). The server resolves these with run
    # scope so they win over global admin routes for the lifetime of the
    # run. Secrets are never accepted here - use ``api_key_ref`` to point
    # at a name in the encrypted secret store.
    llm_overrides: dict[str, dict[str, Any]] | None = Field(default=None, alias="llmOverrides")

    model_config = {"populate_by_name": True}


class SendMessageRequest(BaseModel):
    content: str


class DashboardOverview(BaseModel):
    runs: dict[str, Any]
    findings: dict[str, Any]
    tokens: dict[str, Any]
    throttle: dict[str, Any]


class OrgSummary(BaseModel):
    id: str
    name: str
    slug: str
    member_count: int = Field(alias="memberCount")

    model_config = {"populate_by_name": True}


class AdminOrgRow(BaseModel):
    org: OrgSummary
    runs_total: int = Field(alias="runsTotal")
    runs_active: int = Field(alias="runsActive")
    findings_total: int = Field(alias="findingsTotal")
    last_active_at: str = Field(alias="lastActiveAt")
    health_score: int = Field(alias="healthScore")

    model_config = {"populate_by_name": True}


class AuditEntry(BaseModel):
    id: str
    actor: dict[str, Any]
    action: str
    target: str
    timestamp: str
    ip: str | None = None
    metadata: dict[str, Any] | None = None


class RateLimitSnapshot(BaseModel):
    provider: str
    model: str
    tpm: dict[str, int]
    rpm: dict[str, int]
    queued: int
    retries: int
    status: Literal["ok", "throttled", "cooldown"]


SystemStatus = Literal["healthy", "degraded", "down", "disabled"]


class ServiceCheck(BaseModel):
    name: str
    status: SystemStatus
    latency_ms: float | None = Field(default=None, alias="latencyMs")
    detail: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class EndpointMetric(BaseModel):
    method: str
    path: str
    count: int
    errors5xx: int
    errors4xx: int
    error_rate: float = Field(alias="errorRate")
    latency_ms_p50: float = Field(alias="latencyMsP50")
    latency_ms_p95: float = Field(alias="latencyMsP95")
    latency_ms_avg: float = Field(alias="latencyMsAvg")
    last_seen_at: float = Field(alias="lastSeenAt")

    model_config = {"populate_by_name": True}


class EndpointDescriptor(BaseModel):
    method: str
    path: str
    name: str = ""


class EnvVarRow(BaseModel):
    key: str
    set: bool
    secret: bool
    value: str = ""
    preview: str = ""


class ApiProcessInfo(BaseModel):
    version: str
    environment: str
    hostname: str
    python: str
    uptime_seconds: float = Field(alias="uptimeSeconds")
    started_at: str = Field(alias="startedAt")

    model_config = {"populate_by_name": True}


class AuthConfigInfo(BaseModel):
    enabled: bool
    issuer: str = ""
    jwks_url: str = Field(default="", alias="jwksUrl")
    audience: str = ""
    admin_email_count: int = Field(default=0, alias="adminEmailCount")
    api_key_count: int = Field(default=0, alias="apiKeyCount")

    model_config = {"populate_by_name": True}


class RuntimeTotals(BaseModel):
    total: int
    errors5xx: int
    errors4xx: int
    error_rate: float = Field(alias="errorRate")
    last_seen_at: float | None = Field(default=None, alias="lastSeenAt")

    model_config = {"populate_by_name": True}


class SystemHealthSnapshot(BaseModel):
    status: SystemStatus
    generated_at: str = Field(alias="generatedAt")
    process: ApiProcessInfo
    auth: AuthConfigInfo
    services: list[ServiceCheck]
    endpoints: list[EndpointDescriptor]
    metrics: list[EndpointMetric]
    totals: RuntimeTotals
    rate_limits: list[RateLimitSnapshot] = Field(alias="rateLimits")
    active_runs: list[dict[str, Any]] = Field(alias="activeRuns")
    env: list[EnvVarRow]

    model_config = {"populate_by_name": True}


def iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"
