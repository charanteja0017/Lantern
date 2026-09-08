# Installing NovaHunter on Ubuntu (backend + frontend)

This guide brings up the **entire NovaHunter platform** on a fresh
Ubuntu (or Debian) VPS with nothing more than a public IP address.

Both tiers ship in a single `docker compose` stack:

- **Next.js 16 frontend** — the dashboard you browse to
- **FastAPI backend** — the agent orchestrator / API
- **Postgres 16** — metadata & index
- **Redis 7** — rate limits + websocket pub/sub
- **Caddy** — HTTP reverse proxy on port 80 (HTTPS optional later)

You do **not** need a domain name, TLS certificate, LLM API key, or Clerk
account to start. Those are all configured later from the admin UI.

> **Note on paths** — the examples below use `/opt/novahunter` as the
> location of your cloned repo. Substitute whichever directory you cloned
> the repo into (e.g. `~/NovaHunter` or `/srv/NovaHunter`). The installer
> always uses the checkout it is launched from, never a hard-coded path.

---

## 1. Prerequisites

| Resource  | Recommended                    | Minimum             |
| --------- | ------------------------------ | ------------------- |
| OS        | Ubuntu 22.04 LTS / 24.04 LTS   | Debian 12+          |
| CPU       | 2 vCPU                         | 1 vCPU              |
| RAM       | 4 GB                           | 2 GB                |
| Disk      | 20 GB SSD                      | 10 GB               |
| Network   | Public IPv4, port 80 inbound   | Any reachable IP    |

Everything runs in Docker. You do **not** need Node.js, Python or any
build toolchain on the host — the installer handles that.

---

## 2. Install

SSH into your VPS as a user with `sudo` privileges. Clone the repo yourself
(`git clone`, `scp`, or `rsync` — whatever works with your setup, including
private repos and deploy keys), then run the installer from inside the
checkout:

```bash
git clone https://github.com/MaramHarsha/NovaHunter.git
cd NovaHunter
sudo bash scripts/setup.sh
```

The installer will:

1. Install Docker Engine + the Compose plugin (if missing).
2. Generate `deploy/.env` with:
   - a strong random Postgres password
   - development-mode defaults so the stack boots without Clerk / LLM keys
3. `docker compose up -d --build` the full stack (frontend + backend + DB + Redis + Caddy).
4. Wait for every service to report `healthy`.
5. Print the dashboard URL like:

   ```
   NovaHunter is live!
       Dashboard : http://203.0.113.17/
       API       : http://203.0.113.17/api/
       Health    : http://203.0.113.17/api/health
   ```

The script will **not** clone, fetch, or reset the repo — it always uses the
checkout it was launched from. That keeps private-repo credentials out of
the installer entirely and makes re-running the script on top of a local
edit completely safe.

Use `--dry-run` to preview every command before it runs:

```bash
sudo bash scripts/setup.sh --dry-run
```

---

## 3. What the installer deploys

| Service    | Image / Build                          | Internal port | Role                                 |
| ---------- | -------------------------------------- | ------------- | ------------------------------------ |
| `caddy`    | `caddy:2-alpine`                       | 80            | Public reverse proxy                 |
| `frontend` | built from `frontend/Dockerfile`       | 3000          | Next.js 16 dashboard (App Router)    |
| `api`      | built from `strix/api/Dockerfile`      | 8000          | FastAPI backend + agent orchestrator |
| `postgres` | `postgres:16-alpine`                   | 5432          | Metadata + run index                 |
| `redis`    | `redis:7-alpine`                       | 6379          | Rate limits + pub/sub                |

Only `caddy` binds to a host port (80). Everything else is on the internal
`strix_net` bridge network — not reachable from the internet.

---

## 4. First-run configuration (optional)

Out of the box the stack runs in **development mode**, which means:

- No Clerk authentication is enforced (admin routes are open).
- The frontend hits the real backend on `/api`.
- No LLM provider is configured — scans requiring a model will report that
  until you add one.

To unlock production features, open the admin UI and fill in the config:

1. Browse to `http://<public-ip>/admin`.
2. Add your LLM provider + API key (OpenAI, Anthropic, OpenRouter, Gemini,
   Bedrock, Azure…).
3. Optionally connect Clerk for authentication.
4. Edit `/opt/novahunter/deploy/.env`, set `STRIX_ENV=production`, then
   `docker compose -f /opt/novahunter/deploy/docker-compose.yml restart api`.

> All of the Clerk and LLM variables are listed in `deploy/.env.example`.
> You can set them from the dashboard, or edit `deploy/.env` directly — both
> work.

---

## 5. Enabling HTTPS with a domain (optional)

1. Point a DNS `A` record at the VPS IP.
2. Open ports 80 and 443:
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```
3. Edit `/opt/novahunter/deploy/.env`:
   ```env
   STRIX_DOMAIN=your.domain.tld
   STRIX_TLS_EMAIL=admin@your.domain.tld
   ```
4. In `/opt/novahunter/deploy/Caddyfile` replace the `:80 { ... }` block
   with `{$STRIX_DOMAIN} { ... }` and delete the `auto_https off` line.
5. Reload the proxy:
   ```bash
   cd /opt/novahunter/deploy
   sudo docker compose --env-file .env up -d caddy
   ```

Caddy will now obtain and renew a Let's Encrypt certificate automatically.

---

## 6. Managing the stack

All commands below assume the default install path:

```bash
cd /opt/novahunter/deploy

# Live status:
sudo docker compose ps

# Tail all logs (Ctrl-C to exit):
sudo docker compose logs -f

# Tail just the frontend or backend:
sudo docker compose logs -f frontend
sudo docker compose logs -f api

# Restart a single service after changing .env:
sudo docker compose restart api

# Rebuild after pulling new code:
sudo docker compose --env-file .env up -d --build

# Stop everything (volumes preserved):
sudo docker compose down

# Stop AND wipe the databases (DESTRUCTIVE):
sudo docker compose down -v
```

### Changing `.env` and redeploying

All runtime config lives in `/opt/novahunter/deploy/.env`. Edit it with any
editor, then redeploy — the correct command depends on **which variable**
you changed:

```bash
cd /opt/novahunter/deploy
sudo nano .env            # or `vi .env`, `vim .env`, etc.
```

| Variable you edited                                   | Command to apply the change                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_DEMO`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Rebuild the frontend image** — these are baked into the browser bundle at build time: `sudo docker compose --env-file .env up -d --build frontend` |
| `STRIX_ENV`, `CLERK_*` (server), `LLM_*`, `POSTGRES_*`, `STRIX_ALLOWED_ORIGINS`, `STRIX_TRUSTED_HOSTS` | Restart the affected service: `sudo docker compose --env-file .env up -d api` (or `postgres`, `redis`, …) |
| `STRIX_DOMAIN`, `STRIX_TLS_EMAIL` (enabling HTTPS)    | `sudo docker compose --env-file .env up -d caddy` (also edit `Caddyfile` per §5) |

If you're not sure, this command rebuilds any stale images and restarts
everything in-place — it's always safe:

```bash
sudo docker compose --env-file .env up -d --build
```

> **Why the rebuild for `NEXT_PUBLIC_*`?** Next.js inlines every
> `NEXT_PUBLIC_*` value into the client JavaScript bundle at build time.
> Changing them in `.env` alone is not enough — the compiled bundle that
> the browser downloads still has the old value until the frontend image
> is rebuilt. Docker Compose reads these from `build.args:` in
> `docker-compose.yml`, which are sourced from your `.env`.

### Switching the dashboard out of demo mode

The installer now defaults `NEXT_PUBLIC_DEMO=false` at build time, so a
fresh install already hits the real backend. If an earlier install came
up in demo mode, fix it with:

```bash
cd /opt/novahunter/deploy
echo 'NEXT_PUBLIC_DEMO=false' | sudo tee -a .env
sudo docker compose --env-file .env up -d --build frontend
```

After the rebuild finishes (~1–2 min) refresh your browser — the demo
banner at the top should be gone and the dashboard will show live
(initially empty) data from the API.

### Upgrading

The installer never touches git — pull updates yourself with whichever
workflow matches your deployment, then re-run the script from the same
checkout:

```bash
cd /path/to/your/NovaHunter   # wherever you cloned it
git pull                      # or: git fetch && git checkout <tag>
sudo bash scripts/setup.sh --dry-run   # preview the redeploy
sudo bash scripts/setup.sh             # apply
```

The installer performs these extra safety steps automatically:

1. Prints a preflight summary (source tree, git revision, running services)
   before any mutation.
2. Writes a timestamped backup of `deploy/.env`, the compose file hash,
   and a best-effort `pg_dumpall` under `<checkout>/backups/`.
3. If a container fails to become healthy after `docker compose up`,
   prints an exact rollback recipe referencing the latest backup.

Useful flags:

| Flag | When to use |
|------|------------|
| `--dry-run` | Preview every command without executing it. |
| `--no-backup` | Skip the pre-deploy backup (not recommended on prod). |
| `--yes` | Assume "yes" to destructive confirmations (non-interactive). |

### Backups

Daily `pg_dump` of the metadata DB:

```bash
cd /opt/novahunter/deploy
sudo docker compose exec postgres pg_dump -U strix strix \
  | gzip > "novahunter-$(date +%F).sql.gz"
```

The scan artifact volume (`strix_runs`) is also worth snapshotting:

```bash
sudo docker run --rm \
  -v strix_runs:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/runs-$(date +%F).tgz /data
```

---

## 7. Firewall (ufw)

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # NovaHunter (HTTP)
# sudo ufw allow 443/tcp  # only if you enabled HTTPS above
sudo ufw --force enable
sudo ufw status numbered
```

That is the only ingress NovaHunter needs.

---

## 8. Troubleshooting

### The installer says `permission denied` or `Cannot connect to Docker daemon`

Re-run it with `sudo` (it expects root privileges to install Docker and
write to `/opt/novahunter`).

### The dashboard loads but API calls fail

Check the backend log:

```bash
sudo docker compose -f /opt/novahunter/deploy/docker-compose.yml logs -f api
```

The most common cause is the API waiting on Postgres/Redis; give it another
30 seconds. `docker compose ps` should show all services as `healthy`.

### I want to completely reset and re-install

From inside your checkout:

```bash
cd /path/to/NovaHunter/deploy
sudo docker compose down -v
cd ..
# Optionally re-clone into a fresh directory if you want a clean tree:
#   rm -rf /path/to/NovaHunter
#   git clone https://github.com/MaramHarsha/NovaHunter.git
sudo bash scripts/setup.sh
```

### The installer couldn't detect my public IP

Set it manually, e.g.:

```bash
# Nothing to do in .env — just browse to http://<your-ip>/ directly.
# Or bake it into Caddy's hostname later by setting STRIX_DOMAIN=<ip>.
```

The generated `.env` doesn't lock to a specific IP (`STRIX_TRUSTED_HOSTS=*`),
so the dashboard is reachable at any hostname pointing to the host.

### Port 80 is already in use

Stop whatever is holding it (e.g. nginx/apache) or change the host port:

```bash
# In deploy/docker-compose.yml under the caddy service, change:
#   - "80:80"   →   - "8080:80"
# then re-run:
sudo docker compose -f /opt/novahunter/deploy/docker-compose.yml up -d caddy
```

Browse to `http://<public-ip>:8080/`.

---

## 9. Architecture summary

```
                ┌────────────────────────────┐
 Internet ────► │  Caddy  (host port 80)     │  http://<vps-ip>/
                └──────────┬─────────────────┘
                           │  strix_net (bridge)
                ┌──────────┴──────────┐
                │                     │
         frontend (3000)         api (8000)
         Next.js 16                FastAPI
                                        │
                               ┌────────┴─────────┐
                               │                  │
                          postgres:5432      redis:6379
```

- `frontend` proxies `/api/*` back to `api` (via Caddy + Next.js rewrites).
- `api` stores runs + metadata in `postgres`, rate limits & pubsub in
  `redis`, and scan artifacts in the `strix_runs` volume.

That is the whole platform — one install, one endpoint, one IP.
