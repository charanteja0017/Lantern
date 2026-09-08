"""API runtime configuration loaded from environment variables.

All settings have safe defaults so the API can start for local development
without Postgres/Redis/Clerk configured. Production deployments should set
every variable explicitly via Docker Compose ``.env``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _split(raw: str) -> list[str]:
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass(frozen=True)
class ApiSettings:
    environment: str = "development"
    log_level: str = "INFO"

    allowed_origins: list[str] = field(default_factory=list)
    trusted_hosts: list[str] = field(default_factory=lambda: ["*"])

    runs_dir: str = "strix_runs"

    database_url: str = ""
    redis_url: str = ""

    clerk_issuer: str = ""
    clerk_audience: str = ""
    clerk_jwks_url: str = ""
    # Optional — when set we can hit Clerk's Backend API to look up a user's
    # email from their ``sub`` (Clerk session JWTs don't carry email by
    # default). Purely an enhancement; everything still works with just the
    # user-ID based admin list below.
    clerk_secret_key: str = ""

    admin_emails: list[str] = field(default_factory=list)
    # Clerk user IDs (e.g. ``user_2a…``) that should be elevated to
    # ``platform-admin`` regardless of the email claim. This is the
    # "zero-config" path: the ``sub`` claim is always present in a Clerk JWT,
    # so an operator can unlock the admin surface without configuring a
    # custom JWT template.
    admin_user_ids: list[str] = field(default_factory=list)

    api_keys: list[str] = field(default_factory=list)
    api_keys_file: str = ""

    llm_rpm_default: int = 50
    llm_tpm_default: int = 30_000
    llm_concurrency_default: int = 4

    rate_limit_per_minute: int = 240

    checkpoint_interval_seconds: int = 15
    retention_days: int = 90
    retention_sweep_seconds: int = 60 * 60 * 24
    run_max_evidence_bytes: int = 5 * 1024 * 1024 * 1024

    @property
    def auth_enabled(self) -> bool:
        return bool(self.clerk_jwks_url and self.clerk_issuer)

    @property
    def postgres_enabled(self) -> bool:
        return bool(self.database_url)

    @property
    def redis_enabled(self) -> bool:
        return bool(self.redis_url)


@lru_cache(maxsize=1)
def get_settings() -> ApiSettings:
    return ApiSettings(
        environment=os.getenv("STRIX_ENV", "development"),
        log_level=os.getenv("STRIX_LOG_LEVEL", "INFO"),
        allowed_origins=_split(os.getenv("STRIX_ALLOWED_ORIGINS", "http://localhost:3000")),
        trusted_hosts=_split(os.getenv("STRIX_TRUSTED_HOSTS", "*")) or ["*"],
        runs_dir=os.getenv("STRIX_RUNS_DIR", "strix_runs"),
        database_url=os.getenv("STRIX_DATABASE_URL", ""),
        redis_url=os.getenv("STRIX_REDIS_URL", ""),
        clerk_issuer=os.getenv("CLERK_ISSUER", ""),
        clerk_audience=os.getenv("CLERK_AUDIENCE", ""),
        clerk_jwks_url=os.getenv("CLERK_JWKS_URL", ""),
        clerk_secret_key=os.getenv("CLERK_SECRET_KEY", ""),
        admin_emails=_split(os.getenv("STRIX_ADMIN_EMAILS", "")),
        admin_user_ids=_split(os.getenv("STRIX_ADMIN_USER_IDS", "")),
        api_keys=_split(os.getenv("STRIX_API_KEYS", "")),
        api_keys_file=os.getenv("STRIX_API_KEYS_FILE", ""),
        llm_rpm_default=int(os.getenv("STRIX_LLM_RPM_DEFAULT", "50")),
        llm_tpm_default=int(os.getenv("STRIX_LLM_TPM_DEFAULT", "30000")),
        llm_concurrency_default=int(os.getenv("STRIX_LLM_CONCURRENCY_DEFAULT", "4")),
        rate_limit_per_minute=int(os.getenv("STRIX_API_RPM", "240")),
        checkpoint_interval_seconds=int(os.getenv("STRIX_CHECKPOINT_INTERVAL", "15")),
        retention_days=int(os.getenv("STRIX_RETENTION_DAYS", "90")),
        retention_sweep_seconds=int(os.getenv("STRIX_RETENTION_SWEEP_SECONDS", str(60 * 60 * 24))),
        run_max_evidence_bytes=int(
            os.getenv("STRIX_RUN_MAX_EVIDENCE_BYTES", str(5 * 1024 * 1024 * 1024))
        ),
    )
