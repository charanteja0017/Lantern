# NovaHunter — Project Brief

NovaHunter is a **self-hosted, AI-driven offensive-security control plane**. It lets you run autonomous security-testing “agent” campaigns on your own infrastructure, with a full web dashboard for **runs**, **findings**, **reports**, and **operator tooling**.

It’s built on top of the open-source **Strix** agent runtime (NovaHunter is a fork that keeps the Strix CLI intact), and adds a production-style web stack around it.

---

## What this project does

- **Launch security runs** against targets (repos, directories, URLs) using the Strix agent runtime.
- **Stream runs live** to the dashboard (timeline, agents, tool executions, findings).
- Provide an **operator workbench** during a run:
  - Terminals / shells
  - Live Browser (noVNC-style)
  - Burp panel
  - Listeners (netcat-style workflows)
- Store results as **canonical run artifacts** (events, findings, reports) and export them as `md`, `txt`, `html`, `pdf`, `json`, `sarif`, `csv`.
- Offer **admin controls**:
  - LLM provider settings stored on the server (so scans actually run)
  - Per-role LLM routing (planner/executor/reasoner/reporter/etc.)
  - Encrypted secrets store
  - Integrations (webhook/Slack/Discord/Jira/GitHub Issues)
  - Schedules + retention sweeps
  - System health dashboard

---

## How it runs (architecture at a glance)

Default deployment is a single Docker Compose stack:

- **Caddy** reverse proxy (only public ports)
- **Next.js frontend** dashboard (`frontend/`)
- **FastAPI backend** (`strix/api/`)
- **Postgres + pgvector** (optional but recommended)
- **Redis** (optional but recommended)

The backend starts runs by spawning the **Strix CLI** as a subprocess; Strix writes each run’s artifacts into `STRIX_RUNS_DIR/<run_id>/` (especially `events.jsonl`), and the dashboard consumes those via API + live SSE streaming.

For deep system design, see `PROJECT_OVERVIEW.md`.

---

## Repo map

- `frontend/`: Next.js dashboard (demo mode + live API mode)
- `strix/api/`: FastAPI control plane (runs, findings, exports, admin, sidechannels)
- `strix/`: Strix agent runtime (LLM wrapper, tools, telemetry, CLI)
- `deploy/`: docker compose stack + Caddy proxy + env templates
- `scripts/`: Ubuntu installer (`setup.sh`) and helpers
- `docs/`: install/ops docs, report templates, parity notes

---

## Quickstart (Ubuntu VPS)

Full guide: `docs/INSTALL_UBUNTU.md`

Typical flow:

1. Clone the repo on the server.
2. Run the installer:
   - `sudo bash scripts/setup.sh`
3. Open the dashboard at `http://<server-ip>/`.
4. Configure your **LLM provider** in the UI (Settings → LLM). This is required to actually run scans.

---

## Local development (fast path)

- **Frontend**:
  - `cd frontend`
  - `cp .env.example .env.local`
  - `npm install`
  - `npm run dev`
- **Backend**: easiest via `deploy/docker-compose.yml` so Postgres/Redis are present.

---

## Safety note

NovaHunter is an offensive-security tool. Use it only against systems you own or have explicit permission to test.

