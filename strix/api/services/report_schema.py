"""Canonical ``FindingReport`` schema used for report export.

Today individual agent tools (``create_vulnerability_report``, ``finish_scan``)
emit loose dicts whose shape has evolved organically. That is fine for
storage, but export renderers need a *stable, validated* shape so the PDF,
markdown, SARIF, CSV, etc. never disagree on what a finding "contains".

``FindingReport`` is that shape. It is deliberately close to how HackerOne /
Bugcrowd / OpenBugBounty advise writing a report - the goal is that a human
reviewer reading the rendered PDF would not be able to tell it came from an
autonomous scanner rather than a top-tier bounty hunter.

Rules:

1. All HackerOne-mandatory fields are required (title, severity, summary,
   steps to reproduce, PoC, impact, remediation).
2. ``cvss_vector`` must match the CVSS v3.1 / v4.0 canonical regex.
3. High / critical findings must include at least one reference URL.
4. ``cwe`` entries look like ``"CWE-79"``. ``owasp_top10`` entries look like
   ``"A03:2021 - Injection"``.

The module is pure pydantic + stdlib so it can be imported by renderers
outside the FastAPI app (including MCP exports).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


Severity = Literal["critical", "high", "medium", "low", "informational"]


_CVSS_VECTOR_RE = re.compile(r"^CVSS:(3\.0|3\.1|4\.0)/[A-Z]+:[A-Z0-9]+(/[A-Z]+:[A-Z0-9]+)+$")
_CWE_RE = re.compile(r"^CWE-\d+$")
_OWASP_RE = re.compile(r"^A\d{2}:\d{4}\b")

_SEVERITY_ALIASES: dict[str, Severity] = {
    "crit": "critical",
    "critical": "critical",
    "high": "high",
    "med": "medium",
    "medium": "medium",
    "low": "low",
    "info": "informational",
    "informational": "informational",
    "information": "informational",
    "none": "informational",
}


def _coerce_severity(raw: str | None) -> Severity:
    if raw is None:
        return "informational"
    key = str(raw).strip().lower()
    return _SEVERITY_ALIASES.get(key, "informational")


class FindingReport(BaseModel):
    """Canonical, export-ready shape of a single vulnerability finding."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    id: str = Field(..., min_length=1, description="Stable finding id (hash or UUID).")
    title: str = Field(..., min_length=3, max_length=300)
    severity: Severity
    cvss_vector: str
    cvss_score: float = Field(..., ge=0.0, le=10.0)
    cwe: list[str] = Field(default_factory=list)
    owasp_top10: list[str] = Field(default_factory=list)
    affected_asset: str = Field(..., min_length=1)
    summary: str = Field(..., min_length=10)
    steps_to_reproduce: list[str] = Field(default_factory=list)
    proof_of_concept: str = Field(..., min_length=1)
    impact: str = Field(..., min_length=10)
    remediation: str = Field(..., min_length=10)
    references: list[HttpUrl] = Field(default_factory=list)
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    discovered_by_agent: str = Field(default="autonomous-agent")
    evidence_artifacts: list[str] = Field(default_factory=list)

    @field_validator("cvss_vector")
    @classmethod
    def _check_cvss(cls, v: str) -> str:
        if not _CVSS_VECTOR_RE.match(v):
            raise ValueError(f"cvss_vector must be a CVSS 3.0 / 3.1 / 4.0 string, got {v!r}")
        return v

    @field_validator("cwe")
    @classmethod
    def _check_cwe(cls, v: list[str]) -> list[str]:
        for item in v:
            if not _CWE_RE.match(item):
                raise ValueError(f"CWE entry {item!r} must match 'CWE-<digits>'")
        return v

    @field_validator("owasp_top10")
    @classmethod
    def _check_owasp(cls, v: list[str]) -> list[str]:
        for item in v:
            if not _OWASP_RE.match(item):
                raise ValueError(f"owasp_top10 entry {item!r} must start like 'A03:2021'")
        return v

    @field_validator("steps_to_reproduce")
    @classmethod
    def _check_steps(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s and s.strip()]

    @model_validator(mode="after")
    def _require_refs_for_critical(self) -> FindingReport:
        if self.severity in ("critical", "high") and not self.references:
            raise ValueError(
                "At least one reference URL is required for high/critical findings "
                "(OWASP / CWE / vendor advisory / research write-up)."
            )
        if not self.steps_to_reproduce:
            raise ValueError("steps_to_reproduce must contain at least one step")
        return self


def normalize_to_finding_report(
    raw: dict[str, Any],
    *,
    default_agent: str = "autonomous-agent",
) -> FindingReport:
    """Best-effort adapter from a legacy tracer vulnerability dict to FindingReport.

    The existing ``create_vulnerability_report`` tool and the tracer emit a
    variable shape. This function maps the known legacy keys onto canonical
    fields and fills sensible defaults (e.g. synthesizing a stable ``id``
    from the title + target when one is missing).

    ``ValueError`` is raised if the raw dict is too incomplete to form a
    canonical report - callers should catch and surface the message.
    """
    title = str(raw.get("title") or "").strip()
    if not title:
        raise ValueError("finding has no title; cannot normalize")

    raw_target = str(raw.get("target") or raw.get("affected_asset") or "").strip()
    if not raw_target:
        raise ValueError(f"finding {title!r} has no target / affected_asset")

    stable_id = str(raw.get("id") or "").strip()
    if not stable_id:
        digest = hashlib.sha256(f"{title}|{raw_target}".encode()).hexdigest()
        stable_id = f"finding-{digest[:16]}"

    severity = _coerce_severity(raw.get("severity"))

    cvss_vector = str(raw.get("cvss_vector") or "").strip()
    if not cvss_vector:
        # Legacy callers store a breakdown dict; reconstruct the vector string
        # from the 8 base-metric keys if available.
        breakdown = raw.get("cvss_breakdown") or raw.get("cvss") or {}
        if isinstance(breakdown, dict):
            ordered = (
                ("AV", breakdown.get("attack_vector")),
                ("AC", breakdown.get("attack_complexity")),
                ("PR", breakdown.get("privileges_required")),
                ("UI", breakdown.get("user_interaction")),
                ("S", breakdown.get("scope")),
                ("C", breakdown.get("confidentiality")),
                ("I", breakdown.get("integrity")),
                ("A", breakdown.get("availability")),
            )
            if all(val for _, val in ordered):
                cvss_vector = "CVSS:3.1/" + "/".join(f"{k}:{v}" for k, v in ordered)

    if not cvss_vector:
        cvss_vector = _default_cvss_for_severity(severity)

    cvss_score = _coerce_float(
        raw.get("cvss_score") or raw.get("cvss"), default=_default_score_for_severity(severity)
    )

    summary = str(
        raw.get("summary") or raw.get("description") or raw.get("technical_analysis") or title
    ).strip()

    steps = raw.get("steps_to_reproduce")
    if isinstance(steps, str):
        steps = [line.strip() for line in steps.splitlines() if line.strip()]
    if not steps:
        steps = _derive_steps_from_legacy(raw)
    if not steps:
        # Last-resort default so the validator does not reject legacy data.
        steps = [f"Issue {title} reproduction steps were not recorded explicitly by the agent."]

    poc = str(
        raw.get("proof_of_concept")
        or raw.get("poc_script_code")
        or raw.get("poc_description")
        or ""
    ).strip()
    if not poc:
        poc = "PoC not provided by agent."

    impact = str(raw.get("impact") or "Impact not explicitly recorded.").strip()
    remediation = str(
        raw.get("remediation")
        or raw.get("remediation_steps")
        or "Remediation not explicitly recorded."
    ).strip()

    references = _coerce_references(raw.get("references"))
    if severity in ("critical", "high") and not references:
        references = [
            _cwe_reference_url(raw.get("cwe")) or "https://owasp.org/www-project-top-ten/"
        ]

    cwe_list = _coerce_string_list(raw.get("cwe"), pattern=_CWE_RE, normalize="upper")
    owasp_list = _coerce_string_list(raw.get("owasp_top10") or raw.get("owasp"))

    discovered_by = str(
        raw.get("discovered_by_agent") or raw.get("reporter_agent") or default_agent
    )

    evidence = _coerce_string_list(raw.get("evidence_artifacts") or raw.get("evidence") or [])

    return FindingReport(
        id=stable_id,
        title=title,
        severity=severity,
        cvss_vector=cvss_vector,
        cvss_score=cvss_score,
        cwe=cwe_list,
        owasp_top10=owasp_list,
        affected_asset=raw_target,
        summary=summary,
        steps_to_reproduce=list(steps),
        proof_of_concept=poc,
        impact=impact,
        remediation=remediation,
        references=references,  # type: ignore[arg-type]
        discovered_by_agent=discovered_by,
        evidence_artifacts=evidence,
    )


def normalize_many(raw: Iterable[dict[str, Any]]) -> list[FindingReport]:
    """Normalize an iterable of legacy dicts; skips ones that fail validation."""
    out: list[FindingReport] = []
    for item in raw:
        try:
            out.append(normalize_to_finding_report(item))
        except (ValueError, TypeError):
            continue
    return out


# --- helpers ----------------------------------------------------------------


_SEV_DEFAULT_VECTOR: dict[str, str] = {
    "critical": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "high": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N",
    "medium": "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N",
    "low": "CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N",
    "informational": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:N",
}


_SEV_DEFAULT_SCORE: dict[str, float] = {
    "critical": 9.8,
    "high": 7.5,
    "medium": 5.3,
    "low": 3.1,
    "informational": 0.0,
}


def _default_cvss_for_severity(sev: Severity) -> str:
    return _SEV_DEFAULT_VECTOR[sev]


def _default_score_for_severity(sev: Severity) -> float:
    return _SEV_DEFAULT_SCORE[sev]


def _coerce_float(raw: Any, *, default: float) -> float:
    try:
        if raw is None:
            return default
        return float(raw)
    except (TypeError, ValueError):
        return default


def _coerce_references(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        candidate = item.strip()
        if candidate.startswith("http://") or candidate.startswith("https://"):
            out.append(candidate)
    return out


def _coerce_string_list(
    raw: Any,
    *,
    pattern: re.Pattern[str] | None = None,
    normalize: str | None = None,
) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    cleaned: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        v = item.strip()
        if normalize == "upper":
            v = v.upper()
        if pattern and not pattern.match(v):
            continue
        if v:
            cleaned.append(v)
    return cleaned


def _derive_steps_from_legacy(raw: dict[str, Any]) -> list[str]:
    poc_desc = raw.get("poc_description") or raw.get("description")
    if not isinstance(poc_desc, str):
        return []
    lines = [ln.strip(" -*1234567890.") for ln in poc_desc.splitlines()]
    steps = [ln for ln in lines if ln]
    return steps[:20]


def _cwe_reference_url(raw: Any) -> str | None:
    if raw is None:
        return None
    candidate = str(raw).strip()
    match = re.search(r"CWE-(\d+)", candidate)
    if not match:
        return None
    return f"https://cwe.mitre.org/data/definitions/{match.group(1)}.html"
