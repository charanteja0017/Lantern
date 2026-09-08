<div align="center">

# NovaHunter

### Self-hosted, SaaS-style offensive-security control plane.

NovaHunter is a **multi-tenant SaaS-style** product: people work inside
**organizations** (tenants), and both the web dashboard and API enforce
**role-based access** within those boundaries — plus an optional
cross-tenant operator role for platform administration. You still deploy
the stack on **your own** VPS or cluster so runs, findings, and secrets stay
on infrastructure you control — with a full web UI, a REST + websocket API,
and a single bash installer for a bare Ubuntu box.

<br/>

<a href="https://github.com/MaramHarsha/NovaHunter"><img src="https://img.shields.io/github/stars/MaramHarsha/NovaHunter?style=flat-square" alt="GitHub Stars"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-3b82f6?style=flat-square" alt="License"></a>
<a href="docs/INSTALL_UBUNTU.md"><img src="https://img.shields.io/badge/install-Ubuntu%20one--liner-2b9246?style=flat-square&logo=ubuntu&logoColor=white" alt="Ubuntu installer"></a>
<img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js" alt="Next.js 16">
<img src="https://img.shields.io/badge/React-19.2-149eca?style=flat-square&logo=react" alt="React 19.2">
<img src="https://img.shields.io/badge/FastAPI-backend-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">
<img src="https://img.shields.io/badge/Docker-compose-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">

</div>

---

## Contributing

**NovaHunter is open for contributors.** Bug fixes, docs, dashboard UX, API
endpoints, deploy hardening, and tests are all in scope—open an issue first
for larger changes so we can align on direction.

Please open [issues](https://github.com/MaramHarsha/NovaHunter/issues) for
bugs or ideas, or submit a [pull request](https://github.com/MaramHarsha/NovaHunter/pulls)
with a short description of the change and how you tested it. For local dev
setup (Python, Docker, `uv`, pre-commit), see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Credit & upstream

NovaHunter is a **fork of [Strix](https://github.com/usestrix/strix)**
(Apache-2.0 licensed) from the [UseStrix](https://strix.ai) team. All the
heavy lifting — the agent graph, hacker toolkit, HTTP proxy, browser
automation, vulnerability reasoning, LiteLLM-backed model adapters, run
artifact format — is theirs. Huge thanks to the Strix maintainers and
contributors for open-sourcing a genuinely remarkable project. If you like
what you see here, please also ⭐ the upstream repository.

NovaHunter builds **on top of** Strix with the following additions:

- A full **Next.js 16 web dashboard** (`frontend/`) — runs, findings,
  reports, analytics, admin panels, live run view, API docs, command palette.
- A **FastAPI backend** (`strix/api/`) exposing a REST + websocket API over
  the Strix agent core, with Postgres-backed metadata, Redis-backed rate
  limits, Clerk auth hooks, and an admin audit log.
- A production `docker compose` stack (`deploy/`) that wires the dashboard,
  the backend, Postgres, Redis, and a Caddy reverse proxy into one deploy.
- A **zero-prompt Ubuntu installer** (`scripts/setup.sh`) that stands up
  the whole stack on a fresh VPS with just a public IP.

The original Strix CLI (`strix --target …`) is still here and still works
the same way — NovaHunter extends the project, it does not replace it.

---

## What's included

| Tier        | Tech                                  | Lives in           |
| ----------- | ------------------------------------- | ------------------ |
| Dashboard   | Next.js 16 · React 19.2 · Tailwind    | `frontend/`        |
| API server  | FastAPI · SQLAlchemy · Redis          | `strix/api/`       |
| Agent core  | **Strix agent graph + hacker toolkit** | `strix/`           |
| Deploy      | docker compose · Caddy · Postgres 16 · Redis 7 | `deploy/` |
| Installer   | Pure bash, idempotent, non-interactive | `scripts/setup.sh` |
| Docs        | Ubuntu install guide · API reference   | `docs/`            |

---

## Organizations & roles (SaaS model)

**Organizations** are the tenant boundary: members of one org see that org’s
runs, findings, and settings. With Clerk enabled, JWT claims carry org
membership; the backend maps Clerk’s organization roles into the internal
roles below (for example, Clerk’s `org:member` maps to **viewer**, and
`org:owner` maps to **admin**).

| Role | Scope | What it can do |
| ---- | ----- | ---------------- |
| **Viewer** | Own organization | Read-only access to dashboards, runs, findings, and reports. |
| **Analyst** | Own organization | Everything **viewer** can do, plus creating and stopping runs and sending messages to agents. |
| **Admin** | Own organization | Full access scoped to that organization (team and org-level configuration the product exposes to admins). |
| **Platform admin** | Cross-tenant | Platform operator: cross-org visibility, support-style actions, LLM routing, audit views — actions are **fully audited**. Granted via configured admin emails or user IDs (see environment docs), not ordinary org membership alone. |

In the dashboard, your effective role comes from the backend
(`GET /api/auth/whoami`), not from stale client defaults — especially for
**platform admin**, which may be elevated server-side from `STRIX_ADMIN_EMAILS` /
`STRIX_ADMIN_USER_IDS` (or equivalent deployment settings).

---

## What's new in this build

- **Run control plane**: mid-run `pause` / `resume` / `restart` / `kill` + per-run budget caps.
- **Operator cockpit**: run-level **Terminals** tab (xterm), **Live Browser** tab (noVNC), and **Burp** tab.
- **Burp + Caido coexistence**: both available; agents can choose tooling per task.
- **Persistent shell + netcat workflows**: spawn/read/write/close shells and listener management APIs/UI.
- **LLM role router**: role-scoped model routes, per-run overrides, role usage/cost telemetry.
- **Encrypted secret store**: AES-GCM-backed secret references for provider/integration credentials.
- **Reporting upgrades**: canonical finding schema and exports in `md`, `txt`, `html`, `pdf`, `json`, `sarif`, `csv`.
- **Program governance**: finding dedup fingerprints, triage lifecycle, retest endpoint, scheduled scans.
- **Outbound integrations**: webhook, Slack, Discord, Jira, GitHub Issues.
- **Storage/abuse controls**: retention sweeps + evidence cap trimming + per-host politeness/rate limits.
- **MCP support**: NovaHunter as MCP server (`stdio`, `HTTP+SSE`) and MCP client (gallery + custom endpoints).

---

## Latest additions (2026-04-25)

- Added **Burp route hardening** so API Burp endpoints execute real Burp tool actions instead of static stubs.
- Added **durable MCP persistence**:
  - Postgres tables for MCP servers/tokens when DB is enabled.
  - File-backed fallback at `STRIX_RUNS_DIR/.config/mcp_registry.json` when Postgres is unavailable.
- Added **MCP Settings entry** in Settings for easier access to client-side MCP configuration.
- Added **new test scaffolding**:
  - `tests/api/test_mcp_routes.py`
  - `tests/api/test_burp_routes.py`
  - `tests/tools/test_capabilities_tool.py`
- Added comprehensive implementation history in `changelogs.md`.

## Latest additions (2026-05-01)

- Added **run restart** support in the control plane:
  - New `restart` action in run controls and command palette.
  - Restart reuses the previous run's saved target + scan configuration and starts a fresh run id.
- Added **NVIDIA NIM model normalization** for LiteLLM compatibility:
  - Models entered as `mistralai/...` against NIM's OpenAI-compatible endpoint are normalized automatically.
  - Prevents `LLM Provider NOT provided` errors on NIM setups.
- Hardened **run shell APIs**:
  - Shell sessions are auto-created on read/write paths so `default` shell polling does not 500 before explicit spawn.
- Improved **Runs mobile UX**:
  - Run detail tabs use horizontal scrolling with non-wrapping tab chips on small screens.
- Hardened **LLM usage telemetry endpoint**:
  - Defensive numeric parsing for token/cost aggregation to avoid malformed-event 500s.

---

## Quick start — self-host on Ubuntu

Fresh Ubuntu 22.04 / 24.04 (or Debian 12+) VPS with a public IP is all you
need. No domain, no TLS cert, no LLM key required up front.

### Run `scripts/setup.sh` (one-shot installer)

[`scripts/setup.sh`](scripts/setup.sh) is a **single bash script** that installs Docker if needed,
writes `deploy/.env`, runs preflight checks, and brings up **frontend + API +
Postgres + Redis + Caddy** via `docker compose`. It must run **inside a full
clone** of this repository (it does not `git clone` for you — it needs
`deploy/docker-compose.yml` on disk).

**Steps on the VPS:**

1. SSH into the server.
2. Install Git if you do not have it: `sudo apt update && sudo apt install -y git`
3. Clone and enter the repo:
   ```bash
   git clone https://github.com/MaramHarsha/NovaHunter.git
   cd NovaHunter
   ```
4. Run the installer **as root** (it will call `docker` and write under `deploy/`):
   ```bash
   sudo bash scripts/setup.sh
   ```

**Useful options** (see also `sudo bash scripts/setup.sh --help`):

| Flag / env | Purpose |
| ---------- | ------- |
| `--dry-run` | Print actions only; safe on a live box. Same idea: `STRIX_SETUP_DRY_RUN=1`. |
| `--yes` / `-y` | Non-interactive confirmations for destructive steps. |
| `--no-backup` | Skip backup of existing `deploy/.env` / Postgres before redeploy. |
| `NOVA_HTTP_PORT=8080` | Publish Caddy on a port other than **80** (e.g. `8080`). |

**One line** (clone + install), if Git is already installed:

```bash
git clone https://github.com/MaramHarsha/NovaHunter.git && cd NovaHunter && sudo bash scripts/setup.sh
```

What happens in ~5 minutes:

1. Docker Engine + Compose plugin are installed if missing.
2. `deploy/.env` is generated with a random Postgres password, `STRIX_MASTER_KEY`, and safe defaults (Clerk keys left empty until you add your own — see [Environment & setup](#environment--setup) below).
3. Preflight checks validate required ports and runtime dependencies.
4. `docker compose up -d --build` launches **frontend + backend + Postgres + Redis + Caddy**.
5. Every container is waited on until `healthy`.
6. The installer prints:
   ```
   NovaHunter is live!
       Dashboard : http://<your-vps-ip>/
       API       : http://<your-vps-ip>/api/
       Health    : http://<your-vps-ip>/api/health
   ```

**What to keep:** After `setup.sh` finishes, your deployment’s “source of
truth” for secrets and tuning is **`deploy/.env`** (Postgres password,
`STRIX_MASTER_KEY`, Clerk keys, `STRIX_ADMIN_*`, LLM variables, `STRIX_ENV`,
`DOCKER_GID`, `NEXT_PUBLIC_*`, ports, and everything else you add). Back it
up off-box. The stack also stores data in **Docker named volumes** (Postgres,
run workspace, Redis, Caddy) — protect those the same way you would a database
disk. If you customize routing, keep your edited **`deploy/Caddyfile`** (or
document how you diverged from the repo).

**When you change `deploy/.env`:** Variables are wired through Compose into
containers, but the **frontend image bakes `NEXT_PUBLIC_*` values at build
time** — they are not picked up from runtime env alone. From the repo root:

```bash
cd deploy
docker compose up -d --build
```

That rebuilds images as needed and recreates services so new values apply.
(If you only changed API/runtime secrets and not any `NEXT_PUBLIC_*` build
args, `docker compose up -d --force-recreate api` is often enough — when in
doubt, use `--build`.) More detail: [Preserving state and reloading after
`.env` changes](#preserving-state-and-reloading-after-env-changes).

Browse to `http://<your-vps-ip>/`, sign in, and configure models in
**Settings → LLM** or **Settings → Advanced LLM**.

See **[docs/INSTALL_UBUNTU.md](docs/INSTALL_UBUNTU.md)** for the full guide
(manual install, HTTPS enablement, backups, `ufw`, troubleshooting).

---

## Web dashboard — what you get

- **Overview** — live status of active scans, most recent findings, severity mix.
- **Runs** — searchable history of every scan, live run view with agent
  tree / timeline / findings pane / log stream / run controls.
- **Run workbench** — **Terminals**, **Live Browser**, **Listeners**, and **Burp** tabs.
- **Findings** — severity-indexed list, detail page with CVSS / CWE / CVE
  metadata, reproduction PoC, affected code locations, remediation, status lifecycle.
- **Reports** — run artifact export in `md`, `txt`, `html`, `pdf`, `json`, `sarif`, `csv`.
- **Analytics** — trends, top targets, remediation velocity.
- **Admin** — organizations, LLM role routing, integrations, audit trail, platform settings.
- **API docs** — in-dashboard OpenAPI explorer with a "Try it" runner.
- **Settings** — provider config, role matrix, route tests, MCP settings, and environment controls.

### Live Browser (noVNC/VNC via iframe)

- The run details page includes a **Live Browser** tab that embeds noVNC in an iframe.
- Frontend requests run sidechannels from the API and renders the signed VNC URL.
- Sidechannels are routed through Caddy with run-scoped paths:
  - `/runs/{run_id}/vnc/...`
  - `/runs/{run_id}/shell/...`
  - `/runs/{run_id}/burp/...`
  - `/runs/{run_id}/ovpn/...`
  - `/runs/{run_id}/listeners/...`
- VNC/noVNC services run inside the sandbox container and are managed by `supervisord`.
- Access uses short-lived signed links issued by the sidechannels API.
- Caddy keeps strict security headers globally, but sidechannel routes remove `X-Frame-Options` so noVNC can render inside the dashboard iframe.

Fully responsive — the [previous mobile optimisation pass](#) adapted every
view to work on phones (hamburger drawer, stacked card tables, scalable
panels for the live view).

---

## CLI — original Strix agent (unchanged)

The standalone Strix CLI is preserved end-to-end. You can still use it on
its own, without running the dashboard.

**Prerequisites**

- Docker daemon running
- An LLM API key from any
  [supported provider](https://docs.strix.ai/llm-providers/overview)
  (OpenAI, Anthropic, OpenRouter, Google Vertex, Bedrock, Azure, …)

**Install the CLI**

```bash
curl -sSL https://strix.ai/install | bash     # upstream installer
export STRIX_LLM="openai/gpt-5.4"
export LLM_API_KEY="your-api-key"
```

**Run a scan**

```bash
# Local codebase
strix --target ./app-directory

# GitHub repository
strix --target https://github.com/org/repo

# Black-box web app
strix --target https://your-app.com
```

**Advanced usage**

```bash
# Grey-box authenticated test
strix --target https://your-app.com \
      --instruction "Authenticated testing using credentials: user:pass"

# Source + deployed, multi-target
strix -t https://github.com/org/app -t https://your-app.com

# White-box source-aware quick scan
strix --target ./app-directory --scan-mode standard

# Focused instruction via file
strix --target api.your-app.com --instruction-file ./instruction.md

# PR-diff scope in CI
strix -n --target ./ --scan-mode quick \
      --scope-mode diff --diff-base origin/main
```

**Headless mode** (`-n` / `--non-interactive`) prints findings in real time
and exits non-zero when vulnerabilities are found — drop it into any CI
pipeline:

```yaml
name: nova-pentest
on: [pull_request]
jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - name: Install Strix CLI
        run: curl -sSL https://strix.ai/install | bash
      - name: Scan
        env:
          STRIX_LLM: ${{ secrets.STRIX_LLM }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
        run: strix -n -t ./ --scan-mode quick
```

---

## Capabilities (inherited from Strix)

### Agentic security toolkit

- **Full HTTP proxy** — request/response manipulation and analysis
- **Browser automation** — multi-tab browser for XSS, CSRF, auth-flow testing
- **Terminal environments** — interactive shells for command execution
- **Python runtime** — custom exploit development & validation
- **Reconnaissance** — automated OSINT and attack-surface mapping
- **Code analysis** — static and dynamic capabilities
- **Knowledge management** — structured findings and attack documentation

### Vulnerability classes

- Access control — IDOR, privilege escalation, auth bypass
- Injection — SQL, NoSQL, command injection
- Server-side — SSRF, XXE, deserialization flaws
- Client-side — XSS, prototype pollution, DOM sinks
- Business logic — race conditions, workflow manipulation
- Authentication — JWT flaws, session management
- Infrastructure — misconfigurations, exposed services

### Graph-of-agents

- Distributed workflows — specialist agents per attack class or asset
- Parallel execution for broad, fast coverage
- Dynamic coordination — agents share discoveries in-flight

---

## Architecture

```
                       ┌──────────────────────────┐
 Internet ───────────► │  Caddy  (port 80 / 443)  │
                       └──────────┬───────────────┘
                                  │ strix_net (bridge)
                  ┌───────────────┼───────────────┐
                  │               │               │
           frontend (3000)   api (8000)    postgres / redis
           Next.js 16         FastAPI        state + cache
                                  │
                          ┌───────┴────────┐
                          │ Strix/NovaHunter │
                          │ agent core + tools│
                          └────────────────┘
```

- Only Caddy binds a host port. Postgres and Redis are unreachable from
  outside the Docker network.
- API boots in `development` mode by default so a fresh install is usable
  immediately; flip to `STRIX_ENV=production` once Clerk is configured.
- All service-to-service traffic stays on the internal bridge network.
- Sidechannel access (`/runs/{id}/vnc|shell|burp|ovpn|listeners`) is reverse-proxied through Caddy and signed by API-issued short-lived tokens.

---

## Project layout

```
NovaHunter/
├─ frontend/             # Next.js 16 dashboard (React 19.2)
├─ strix/                # Strix agent core (upstream, preserved)
│  └─ api/               # FastAPI backend + Dockerfile
├─ deploy/               # docker-compose, Caddyfile, .env.example
├─ scripts/
│  ├─ setup.sh           # one-shot Ubuntu installer  ← primary
│  ├─ web-install.sh     # legacy interactive installer
│  ├─ install.sh         # Strix CLI installer (upstream)
│  ├─ build.sh
│  └─ docker.sh
├─ docs/
│  ├─ INSTALL_UBUNTU.md  # full install / ops guide
│  └─ PARITY.md          # feature parity with upstream
├─ benchmarks/ · tests/ · containers/
├─ README.md             # ← this file
├─ LICENSE
└─ pyproject.toml        # agent / CLI dependencies
```

---

## Environment & setup

**Do not commit secrets.** The repo ignores `deploy/.env` and generic `.env` files. Only ever commit the templates (`deploy/.env.example`, `frontend/.env.example`).

### Preserving state and reloading after `.env` changes

`scripts/setup.sh` clones the repo layout, writes **`deploy/.env`**, and runs
`docker compose up -d --build` — it does **not** replace your need to treat
that file and volumes as long-lived state.

| Keep / back up | Why |
| ---------------- | --- |
| **`deploy/.env`** | Holds every secret and deploy knob the compose file reads. Losing it means new random DB passwords (unless you restore from backup) and re-entering Clerk, LLM, and admin settings. |
| **Docker volumes** (`strix_pgdata`, `strix_runs`, `strix_redis`, Caddy data/config) | Application data, scan artifacts, and TLS material live here — not in the git tree. |
| **Installer backups** | Re-running `setup.sh` may write timestamped backups of `.env` (unless you pass `--no-backup`); still keep your own copies. |
| **Custom `deploy/Caddyfile` or compose overrides** | If you changed them on the server, they are not in git unless you maintain a fork or config repo. |

After **any** edit to `deploy/.env`, apply it from the **`deploy/`** directory:

```bash
cd deploy
docker compose up -d --build
```

Use **`--build`** whenever you change **`NEXT_PUBLIC_*`** (Clerk publishable
key, API base URL, demo flag, app name) — the Next.js client bundle is
produced at image build time (`deploy/docker-compose.yml` documents this).
Other variables (API/Clerk server secrets, `STRIX_LLM`, database URL pieces,
etc.) are passed at container **runtime**; recreating the `api` (and
sometimes `frontend`) service is enough, but `docker compose up -d --build`
is the straightforward, safe default so you do not guess which service needs a
rebuild.

### Full stack (Docker on Linux / VPS)

1. Clone the repository and `cd` into it.
2. **Create `deploy/.env`.** Either run `sudo bash scripts/setup.sh` (generates the file) or copy the template manually:
   ```bash
   cp deploy/.env.example deploy/.env
   ```
   Edit `deploy/.env`: set `POSTGRES_PASSWORD` to a long random string (unless the installer already generated one), and optionally fill [Clerk](https://dashboard.clerk.com) variables (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_ISSUER`, `CLERK_JWKS_URL`) plus `STRIX_ADMIN_EMAILS` / `STRIX_ADMIN_USER_IDS` for platform-admin access.
3. With `STRIX_ENV=development` and Clerk vars **empty**, the API still starts and uses a **demo principal** (no real JWT auth). For a normal dashboard login flow, configure Clerk and **rebuild** the frontend image so `NEXT_PUBLIC_*` keys are baked in: `cd deploy && docker compose up -d --build`.
4. Start the stack: `cd deploy && docker compose up -d --build` (or use the installer, which runs compose for you).

Variable reference: see [Configuration reference](#configuration-reference) and inline comments in [`deploy/.env.example`](deploy/.env.example).

### Frontend only (local Next.js)

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local: set NEXT_PUBLIC_DEMO=true for standalone UI with fake data,
# or NEXT_PUBLIC_DEMO=false and NEXT_PUBLIC_API_BASE_URL to your API URL.
npm install
npm run dev
```

### LLM keys for scans

Scans need a model and provider key. Set `STRIX_LLM` and `LLM_API_KEY` in `deploy/.env`, or configure providers in the dashboard (**Settings → LLM**) once the app is running.

---

## Configuration reference

All runtime config lives in `deploy/.env`. The installer generates a
minimal file for you; extra knobs are listed in `deploy/.env.example` and
include:

| Variable                               | Purpose                                   |
| -------------------------------------- | ----------------------------------------- |
| `STRIX_ENV`                            | `development` (default) or `production`   |
| `POSTGRES_PASSWORD`                    | Auto-generated by the installer           |
| `NEXT_PUBLIC_API_BASE_URL`             | `/api` when behind Caddy                  |
| `NEXT_PUBLIC_DEMO`                     | `true` runs the dashboard with fake data  |
| `CLERK_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | Optional auth (enforced in production) |
| `LLM_MODEL` / `LLM_API_KEY`            | LLM provider — or set from the admin UI    |
| `STRIX_MASTER_KEY`                     | AES-GCM key for encrypted secret storage    |
| `STRIX_IMAGE`                          | Sandbox image (default GHCR image)          |
| `STRIX_POLICY_MAX_RPS_PER_HOST`        | Per-target politeness rate limit            |
| `STRIX_POLICY_MAX_CONCURRENCY_PER_HOST`| Per-target concurrency cap                  |
| `STRIX_RETENTION_DAYS`                 | Run retention sweep window                  |
| `STRIX_RUN_MAX_EVIDENCE_BYTES`         | Per-run evidence size trimming cap          |
| `STRIX_ADMIN_EMAILS`                   | Comma-separated admin emails               |
| `STRIX_TRUSTED_HOSTS`                  | Allowed `Host:` values (default `*`)      |
| `STRIX_DOMAIN` / `STRIX_TLS_EMAIL`     | Populate to enable HTTPS via Caddy + Let's Encrypt |

---

## Development

```bash
# Frontend (Next.js 16, Turbopack)
cd frontend
npm install
npm run dev            # http://localhost:3000

# Type-check + lint
npm run type-check
npm run lint

# Production build
npm run build && npm run start
```

```bash
# Backend (FastAPI, served by uvicorn inside Docker)
cd deploy
docker compose up -d postgres redis api
docker compose logs -f api
```

The dashboard and the API can also be developed independently of the
Strix CLI. The CLI has its own install flow documented above.

---

## Documentation map

- `docs/INSTALL_UBUNTU.md` — deployment and operations bootstrap.
- `docs/integrations/outbound.mdx` — webhook/Slack/Discord/Jira/GitHub issue integrations.
- `docs/integrations/mcp.mdx` — MCP server/client config examples for Cursor/Claude Desktop.
- `docs/operations/retention.mdx` — retention and storage hygiene behavior.
- `docs/report-templates/` — canonical report templates and sections.

---

## Support / issues

For NovaHunter-specific issues (dashboard, API, installer, Ubuntu deploy)
file them against this fork:

- https://github.com/MaramHarsha/NovaHunter/issues

For questions about the Strix agent itself, the LLM providers, the hacker
toolkit, or the CLI, please use the upstream resources:

- Upstream repo: https://github.com/usestrix/strix
- Upstream docs: https://docs.strix.ai
- Discord: https://discord.gg/strix-ai

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

NovaHunter retains the upstream Strix copyright and license notices. Any
code written specifically for this fork (the `frontend/`, `strix/api/`,
`deploy/`, and `scripts/setup.sh`) is contributed under the same
Apache-2.0 license.

## Acknowledgements

- The **[Strix](https://github.com/usestrix/strix) team** — for building
  and open-sourcing the agent platform this project is built on.
- [LiteLLM](https://github.com/BerriAI/litellm),
  [Caido](https://github.com/caido/caido),
  [Nuclei](https://github.com/projectdiscovery/nuclei),
  [Playwright](https://github.com/microsoft/playwright), and
  [Textual](https://github.com/Textualize/textual) — foundations that
  Strix (and therefore NovaHunter) stands on.
- Vercel for Next.js 16, the React team for React 19.2, and the FastAPI
  maintainers — the web stack under the dashboard.

---

> [!WARNING]
> NovaHunter (and Strix) are offensive-security tools. Only test
> applications, infrastructure and domains **you own or have written
> permission to test**. You are responsible for using this project
> ethically and legally.
