# syntax=docker/dockerfile:1.7
# Strix web-dashboard API image.
# Build context MUST be the repo root so the full ``strix`` package is available.
# Example: docker build -f strix/api/Dockerfile -t strix-api .

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# --- Docker CLI (sibling-container management) -------------------------------
# The web API launches ``strix`` as a subprocess, which spawns a sandbox
# *sibling* container through the mounted /var/run/docker.sock. The Python
# SDK handles creation/destruction, but cleanup still shells out to the
# `docker` binary (see strix/runtime/docker_runtime.py:cleanup). We ship the
# static CLI so that path works without pulling the full daemon.
ARG DOCKER_CLI_VERSION=27.5.1
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64)  dl_arch="x86_64" ;; \
      aarch64) dl_arch="aarch64" ;; \
      *) echo "Unsupported arch: $arch"; exit 1 ;; \
    esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${dl_arch}/docker-${DOCKER_CLI_VERSION}.tgz" \
      -o /tmp/docker.tgz; \
    tar -xzf /tmp/docker.tgz -C /tmp; \
    mv /tmp/docker/docker /usr/local/bin/docker; \
    chmod 0755 /usr/local/bin/docker; \
    rm -rf /tmp/docker /tmp/docker.tgz; \
    docker --version

WORKDIR /app

# Install the core Strix package (pinned via pyproject.toml).
COPY pyproject.toml uv.lock README.md LICENSE ./
COPY strix/ ./strix/

RUN pip install --upgrade pip \
 && pip install . \
 && pip install -r strix/api/requirements.txt

RUN useradd --create-home --uid 10001 strix \
 && mkdir -p /data/strix_runs \
 && chown -R strix:strix /data

USER strix
ENV STRIX_RUNS_DIR=/data/strix_runs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "strix.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
