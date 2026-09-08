# NovaHunter — Deployment

Production-ready `docker compose` stack that brings up the **entire** platform
on a single Ubuntu/Debian host — backend **and** frontend included:

- **Caddy** — HTTP reverse proxy (port 80, IP-friendly by default, HTTPS opt-in)
- **Next.js 16 frontend** (`frontend/`)
- **FastAPI backend** (`strix/api/`)
- **Postgres 16** — metadata + index
- **Redis 7** — rate limits + websocket pub/sub

Only Caddy is published to the host — every other service talks over the
internal `strix_net` bridge.

## Zero-config quickstart (VPS with just a public IP)

Clone the repo onto the host yourself (the installer no longer does this —
so private repos work without baking credentials into the pipeline), then:

```bash
git clone https://github.com/MaramHarsha/NovaHunter.git
cd NovaHunter
sudo bash scripts/setup.sh
```

The installer treats the checkout it is run from as the source tree. You can
move or rename the directory; it has no hard-coded install path.

What the script does:

1. Prints a **preflight summary** (detected source tree, git revision,
   running services, published ports) *before* mutating anything.
2. Takes a **pre-deploy backup** of `deploy/.env`, the compose file digest,
   and a best-effort Postgres logical dump into
   `<checkout>/backups/<timestamp>/`. Disable with `--no-backup`.
3. Installs Docker Engine + the Compose plugin if missing.
4. Generates `deploy/.env` with a random Postgres password and safe defaults.
5. Auto-detects the public IP of the host.
6. `docker compose up -d --build`s every service.
7. Waits for every container to report `healthy`.
8. Prints the dashboard URL and, on failure, an **exact recovery recipe**
   referencing the most recent backup.

**No domain, no TLS cert, no LLM key and no Clerk account are needed up front.**
LLM providers, admin users and auth are configured later from the admin UI.

### Previewing a redeploy (strongly recommended on live hosts)

```bash
sudo bash scripts/setup.sh --dry-run
```

Prints every command the installer would run (including `docker compose`
and `apt-get`) without touching the system.

### All flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Print the plan; make no changes. Also enabled via `STRIX_SETUP_DRY_RUN=1`. |
| `--no-backup` | Skip the pre-deploy backup step. |
| `--yes` | Don't prompt; assume "yes" for destructive confirmations. |
| `--help` | Show usage text. |

### Updating an existing deployment

Pull updates with your usual git workflow, then re-run the installer:

```bash
cd /path/to/your/NovaHunter/checkout
git pull                          # or: git fetch && git checkout <tag>
sudo bash scripts/setup.sh --dry-run   # preview
sudo bash scripts/setup.sh             # apply
```

## Manual alternative

```bash
git clone https://github.com/MaramHarsha/NovaHunter.git
cd NovaHunter/deploy
cp .env.example .env
# edit .env only if you want to customise Postgres credentials
docker compose --env-file .env up -d --build
docker compose ps
```

Within 3–8 minutes the stack is reachable at `http://<host-ip>`.

## Enabling HTTPS later

When you do have a real domain:

1. Point an `A` record at the host.
2. Set `STRIX_DOMAIN=your.domain.tld` and `STRIX_TLS_EMAIL=you@example.com` in
   `deploy/.env`.
3. In `deploy/Caddyfile`, replace the `:80 { ... }` site block with
   `{$STRIX_DOMAIN} { ... }` and remove the `auto_https off` line.
4. `docker compose restart caddy`.

Caddy will obtain a Let's Encrypt certificate automatically.

## Health checks

Public (behind Caddy):

- `GET /api/health` → Next.js route handler, cheap liveness for the frontend.
- `GET /healthz` → FastAPI liveness (`{"status":"ok"}`).
- `GET /readyz` → FastAPI **real** readiness: probes Postgres, Redis and the
  runs filesystem, returns `503` if any required dependency is down.
- `GET /api/system/health` → **admin-only** full snapshot (services, per-endpoint
  metrics, rate limits, active runs, redacted env audit). Backs the `/health`
  page in the dashboard.

Container-level:

- Frontend, API, Postgres, Redis and Caddy all declare Docker `HEALTHCHECK`s in
  `docker-compose.yml`. Use `docker compose ps` to see live status.

The Strix dashboard itself renders a live status page at `/health` (listed
under *Administration* in the sidebar) that consumes `/api/system/health`
with configurable auto-refresh.

## Data & backups

Persistent volumes that matter:

| Volume             | Contents                        | Backup command                                                      |
| ------------------ | ------------------------------- | ------------------------------------------------------------------- |
| `strix_pgdata`     | Postgres metadata               | `docker compose exec postgres pg_dump -U strix strix | gzip > db.sql.gz` |
| `strix_runs`       | Scan artifacts & checkpoints    | `docker run --rm -v strix_runs:/r -v $PWD:/b alpine tar czf /b/runs.tgz /r` |
| `strix_redis`      | Ephemeral queue state           | safe to lose                                                        |
| `strix_caddy_data` | TLS certs (if HTTPS enabled)    | safe to re-issue                                                    |

## Security posture

- Only port 80 (and 443 if HTTPS is enabled) is exposed publicly.
- Postgres and Redis are unreachable from outside the Docker network.
- Strict security headers set by Caddy.
- API boots in `development` mode by default so you can configure auth *after*
  it is reachable; switch to `STRIX_ENV=production` once Clerk is set up.
