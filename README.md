<div align="center">

# Lantern

### A free, self-hosted AI pentesting tool you run on your own machine.

Lantern points a team of AI security agents at your own apps, APIs and
code, and shows you what they find in a web UI you can watch in real time.

**No subscription. No accounts. No data leaves your machine.** You clone the
repo, bring your own LLM API key, and run the whole thing locally with one
Docker command. Every scan, finding and report stays on your hardware.

<br/>

<img src="https://img.shields.io/badge/price-free%20%26%20self--hosted-2b9246?style=flat-square" alt="Free and self-hosted">
<img src="https://img.shields.io/badge/setup-one%20docker%20command-2496ed?style=flat-square&logo=docker&logoColor=white" alt="One Docker command">
<img src="https://img.shields.io/badge/keys-bring%20your%20own-6366f1?style=flat-square" alt="Bring your own API key">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-3b82f6?style=flat-square" alt="License"></a>
<img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js" alt="Next.js 16">
<img src="https://img.shields.io/badge/FastAPI-backend-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">

</div>

---

## Run the whole stack with one command

One `docker compose` command brings up **everything at once** — the web UI,
the API, Postgres, Redis and the reverse proxy — wired together and ready to
scan. There is nothing to sign up for and no external service to point at.

```bash
git clone https://github.com/charanteja0017/NovaHunter.git
cd Lantern/deploy
cp .env.example .env
docker compose --env-file .env up -d --build
docker compose ps
```

Open **http://localhost** and you are in. First build takes roughly 3–8
minutes; after that it starts in seconds.

| Service | What it is | Published? |
| ------- | ---------- | ---------- |
| `frontend` | Next.js web UI | via proxy |
| `api` | FastAPI backend + agent runner | internal only |
| `postgres` | Findings, runs, history | internal only |
| `redis` | Live updates + rate limits | internal only |
| `caddy` | Reverse proxy — the only thing on a host port | **port 80** |

Only the proxy is exposed; everything else talks over a private Docker
network. Port 80 already in use? Set `LANTERN_HTTP_PORT=8080` in `deploy/.env`
and reach it at `http://localhost:8080`.

```bash
docker compose logs -f api     # watch the backend
docker compose down            # stop everything
docker compose down -v         # stop and wipe the database
```

**Two things worth knowing before you run it.** The stack mounts your Docker
socket, because each scan runs inside its own throwaway sandbox container
that the API launches as a sibling — that is what keeps scan tooling off your
host. And Linux is the tested path; the installer targets Ubuntu/Debian.

### Just want to look at the UI first?

The dashboard runs completely standalone against realistic fake data — no
backend, no database, no keys, nothing to install but Node:

```bash
cd frontend
cp .env.example .env.local     # NEXT_PUBLIC_DEMO=true is already the default
npm install
npm run dev
```

Open **http://localhost:3000** and click around the whole product.

---

## Bring your own API key

Lantern has no hosted service behind it and no key of its own. You supply
a model provider, and calls bill to **your** account at **your** rate — the
tool takes no cut and adds no markup.

Set them in `deploy/.env` before starting:

```bash
STRIX_LLM=anthropic/claude-sonnet-5
LLM_API_KEY=sk-your-own-key
```

…or leave them blank and configure a provider from the UI later under
**Settings → LLM**. Supported providers include Anthropic, OpenAI, Azure,
AWS Bedrock, Google Vertex, OpenRouter, and fully local models via Ollama —
see [`docs/llm-providers/`](docs/llm-providers/overview.mdx). With Ollama,
no API key and no outbound network call is involved at all.

---

## Testing your own products

Lantern is meant to be pointed at things **you own or are authorised to
test**. Typical local workflow:

1. Run your app on your machine (say `http://localhost:8080`).
2. In the UI, hit **New scan** and paste the address.
3. Pick a depth — Quick (~5 min), Standard (~20 min), or Deep (60+ min).
4. Optionally tell the agents what matters: auth flows, business logic,
   endpoints to leave alone.
5. Watch the agents work live, then read the findings.

Because everything runs on your hardware, you can test **internal services,
staging environments and localhost apps** that would be unreachable from any
cloud scanner.

> **Only scan what you have permission to scan.** This tool performs real
> offensive testing — it is not a passive linter.

---

---

## What the UI actually does

Every part of a scan is driven and inspected from the browser — there is no
step where you are expected to drop into a config file to get work done. The
interface is light by default with a dark mode toggle, and works down to a
phone-width screen.

- **Overview** — live status of active scans, most recent findings, severity mix.
- **Runs** — searchable history of every scan, live run view with agent
  tree / timeline / findings pane / log stream / run controls.
- **Run workbench** — **Terminals**, **Live Browser**, **Listeners**, and **Burp** tabs.
- **Findings** — triage list you can actually search and filter: by text, severity,
  and triage state, with the filters held in the URL so a filtered view is a link
  you can paste into a ticket. Detail pages carry CVSS / CWE / CVE metadata,
  reproduction PoC, affected code locations, remediation, and status lifecycle.
- **Reports** — run artifact export in `md`, `txt`, `html`, `pdf`, `json`, `sarif`, `csv`.
- **Analytics** — trends, top targets, remediation velocity.
- **Admin** — LLM role routing, integrations, audit trail, and instance settings.
- **API docs** — in-dashboard OpenAPI explorer with a "Try it" runner.
- **Settings** — provider and API-key config, model routing per agent role,
  route tests, MCP settings, and environment controls — all editable from the UI.

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

## No accounts, at all

There is **no login, no sign-up, no user database and no profile page** — the
dashboard opens straight into the tool. This is not a toggle or a trial mode;
the account system has been removed from the app, so there is nothing to
configure and nothing to bypass.

What that means in practice:

- Anyone who can reach the dashboard can use it. On your own machine that is
  exactly what you want. **If you expose it beyond localhost, put your own
  authentication in front of it** — a reverse proxy with basic auth, a VPN, or
  an SSH tunnel. The app will not do it for you.
- The API still honours cookie credentials, so a proxy that adds auth in front
  of it works without any change to the app.

The backend retains its JWT-verification environment variables for people who
front the API themselves; they are inert unless you deliberately wire them up,
and the dashboard does not use them.

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

## Optional: run it on a server instead of your laptop

Everything above runs fine on your own machine. If you would rather keep an
instance up for a team, or scan from a stable IP, the same stack installs on
a fresh Ubuntu 22.04 / 24.04 (or Debian 12+) box with one script. No domain,
no TLS cert and no LLM key are required up front.

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
   git clone https://github.com/charanteja0017/NovaHunter.git
   cd Lantern
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
| `LANTERN_HTTP_PORT=8080` | Publish Caddy on a port other than **80** (e.g. `8080`). |

**One line** (clone + install), if Git is already installed:

```bash
git clone https://github.com/charanteja0017/NovaHunter.git && cd Lantern && sudo bash scripts/setup.sh
```

What happens in ~5 minutes:

1. Docker Engine + Compose plugin are installed if missing.
2. `deploy/.env` is generated with a random Postgres password, `STRIX_MASTER_KEY`, and safe defaults (see [Environment & setup](#environment--setup) below).
3. Preflight checks validate required ports and runtime dependencies.
4. `docker compose up -d --build` launches **frontend + backend + Postgres + Redis + Caddy**.
5. Every container is waited on until `healthy`.
6. The installer prints:
   ```
   Lantern is live!
       Dashboard : http://<your-vps-ip>/
       API       : http://<your-vps-ip>/api/
       Health    : http://<your-vps-ip>/api/health
   ```

**What to keep:** After `setup.sh` finishes, your deployment’s “source of
truth” for secrets and tuning is **`deploy/.env`** (Postgres password,
`STRIX_MASTER_KEY`, `STRIX_ADMIN_*`, LLM variables, `STRIX_ENV`,
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

Browse to `http://<your-vps-ip>/` (there is no sign-in) and configure models in
**Settings → LLM** or **Settings → Advanced LLM**.

See **[docs/INSTALL_UBUNTU.md](docs/INSTALL_UBUNTU.md)** for the full guide
(manual install, HTTPS enablement, backups, `ufw`, troubleshooting).

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
                          │ Strix/Lantern │
                          │ agent core + tools│
                          └────────────────┘
```

- Only Caddy binds a host port. Postgres and Redis are unreachable from
  outside the Docker network.
- API boots in `development` mode by default so a fresh install is usable
  immediately; `STRIX_ENV=production` tightens API-side checks.
- All service-to-service traffic stays on the internal bridge network.
- Sidechannel access (`/runs/{id}/vnc|shell|burp|ovpn|listeners`) is reverse-proxied through Caddy and signed by API-issued short-lived tokens.

---

## Project layout

```
Lantern/
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
| **`deploy/.env`** | Holds every secret and deploy knob the compose file reads. Losing it means new random DB passwords (unless you restore from backup) and re-entering LLM and admin settings. |
| **Docker volumes** (`strix_pgdata`, `strix_runs`, `strix_redis`, Caddy data/config) | Application data, scan artifacts, and TLS material live here — not in the git tree. |
| **Installer backups** | Re-running `setup.sh` may write timestamped backups of `.env` (unless you pass `--no-backup`); still keep your own copies. |
| **Custom `deploy/Caddyfile` or compose overrides** | If you changed them on the server, they are not in git unless you maintain a fork or config repo. |

After **any** edit to `deploy/.env`, apply it from the **`deploy/`** directory:

```bash
cd deploy
docker compose up -d --build
```

Use **`--build`** whenever you change **`NEXT_PUBLIC_*`** (publishable
key, API base URL, demo flag, app name) — the Next.js client bundle is
produced at image build time (`deploy/docker-compose.yml` documents this).
Other variables (API server secrets, `STRIX_LLM`, database URL pieces,
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
   Edit `deploy/.env`: set `POSTGRES_PASSWORD` to a long random string (unless the installer already generated one). The auth-related variables can stay empty — the dashboard has no accounts.
3. With `STRIX_ENV=development` the API starts with a local principal and no JWT verification. The dashboard has no login flow, so nothing further is needed — put your own auth in front of the proxy if you expose it beyond localhost.
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
| `CLERK_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | Backend-only JWT verification; unused by the dashboard |
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
- **MCP support**: Lantern as MCP server (`stdio`, `HTTP+SSE`) and MCP client (gallery + custom endpoints).

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

## Credit & upstream

Lantern is a **fork of [Strix](https://github.com/usestrix/strix)**
(Apache-2.0 licensed) from the [UseStrix](https://strix.ai) team. All the
heavy lifting — the agent graph, hacker toolkit, HTTP proxy, browser
automation, vulnerability reasoning, LiteLLM-backed model adapters, run
artifact format — is theirs. Huge thanks to the Strix maintainers and
contributors for open-sourcing a genuinely remarkable project. If you like
what you see here, please also ⭐ the upstream repository.

Lantern builds **on top of** Strix with the following additions:

- A full **Next.js 16 web dashboard** (`frontend/`) — runs, findings,
  reports, analytics, admin panels, live run view, API docs, command palette.
- A **FastAPI backend** (`strix/api/`) exposing a REST + websocket API over
  the Strix agent core, with Postgres-backed metadata, Redis-backed rate
  limits, and an admin audit log.
- A production `docker compose` stack (`deploy/`) that wires the dashboard,
  the backend, Postgres, Redis, and a Caddy reverse proxy into one deploy.
- A **zero-prompt Ubuntu installer** (`scripts/setup.sh`) that stands up
  the whole stack on a fresh VPS with just a public IP.

The original Strix CLI (`strix --target …`) is still here and still works
the same way — Lantern extends the project, it does not replace it.

---

## Contributing

**Lantern is open for contributors.** Bug fixes, docs, dashboard UX, API
endpoints, deploy hardening, and tests are all in scope—open an issue first
for larger changes so we can align on direction.

Please open [issues](https://github.com/charanteja0017/NovaHunter/issues) for
bugs or ideas, or submit a [pull request](https://github.com/charanteja0017/NovaHunter/pulls)
with a short description of the change and how you tested it. For local dev
setup (Python, Docker, `uv`, pre-commit), see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Support / issues

For Lantern-specific issues (dashboard, API, installer, Ubuntu deploy)
file them against this fork:

- https://github.com/charanteja0017/NovaHunter/issues

For questions about the Strix agent itself, the LLM providers, the hacker
toolkit, or the CLI, please use the upstream resources:

- Upstream repo: https://github.com/usestrix/strix
- Upstream docs: https://docs.strix.ai
- Discord: https://discord.gg/strix-ai

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

Lantern retains the upstream Strix copyright and license notices. Any
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
  Strix (and therefore Lantern) stands on.
- Vercel for Next.js 16, the React team for React 19.2, and the FastAPI
  maintainers — the web stack under the dashboard.

---

> [!WARNING]
> Lantern (and Strix) are offensive-security tools. Only test
> applications, infrastructure and domains **you own or have written
> permission to test**. You are responsible for using this project
> ethically and legally.
