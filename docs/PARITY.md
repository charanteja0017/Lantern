# Strix Terminal ↔ Dashboard Parity

This matrix tracks feature parity between the original terminal (TUI) app and
the new web dashboard. Every row has a manual smoke-test procedure and, where
feasible, an automated test in `tests/api/` or `frontend/`.

## Legend

- ✅ Implemented in dashboard + automated smoke
- 🟡 Implemented in dashboard, manual verification only
- ⏳ Planned (tracked in the project plan)

| Area                              | Terminal behavior                                  | Dashboard equivalent                                        | Status |
| --------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- | ------ |
| Start a scan                      | `strix --target ...`                               | `POST /api/runs` / "New scan" page                          | ✅     |
| Choose scan/scope mode            | `--scan-mode`, `--scope-mode`                      | Select controls on "New scan" page                          | ✅     |
| Live agent tree                   | Left pane of TUI                                   | `/runs/[id]` → agent tree panel                             | ✅     |
| Per-agent tool stream             | Middle pane                                        | Tool stream panel with live updates via SSE                 | ✅     |
| Send message to agent             | TUI input box                                      | Chat panel → `POST /runs/{id}/agents/{aid}/message`         | ✅     |
| Stop agent                        | `s` hotkey                                         | Agent stop button                                           | ✅     |
| Stop run                          | `Ctrl-C`                                           | Stop button + `POST /runs/{id}/stop`                        | ✅     |
| Resume run from checkpoint        | `strix --resume <id>`                              | Resume button + `POST /runs/{id}/resume`                    | ✅     |
| Findings list                     | Right pane                                         | `/findings` + per-run findings panel                        | ✅     |
| Finding detail (PoC + markdown)   | Scrollable modal                                   | `/findings/[id]`                                            | ✅     |
| Penetration-test report           | `penetration_test_report.md`                       | `/reports` + report viewer in run detail                    | ✅     |
| Token / cost counter              | Status bar                                         | Dashboard overview cards + analytics page                   | ✅     |
| Rate-limit / throttle UX          | Console warning                                    | Visible throttle banner + `/admin/rate-limits`              | ✅     |
| Crash-safe resume (kill / OOM)    | Re-run with `--resume`                             | Same URL; server re-attaches via checkpoint                 | 🟡     |
| Per-org multi-tenancy             | N/A                                                | Clerk orgs + RBAC                                           | ✅     |
| Admin oversight                   | N/A                                                | `/admin/*` (platform-admin only, audited)                   | ✅     |
| Audit log                         | N/A                                                | Append-only `_audit/audit.jsonl` + `/admin/audit`           | ✅     |
| One-command install               | `curl -sSL strix.ai/install | bash`                | `scripts/setup.sh` (zero-prompt, IP-only, full stack)        | ✅     |
| Dark/light theme                  | N/A                                                | `next-themes` toggle                                        | ✅     |
| Fully local demo (no backend)     | N/A                                                | `NEXT_PUBLIC_DEMO=true` with `DemoProvider`                 | ✅     |

## Smoke-test procedure

### 1. Frontend demo mode (no backend, low-spec machine friendly)

```bash
cd frontend
cp .env.example .env.local
# keep NEXT_PUBLIC_DEMO=true
npm install
npm run dev
# open http://localhost:3000 — all screens render with seeded data
```

Expected:

- Home page loads with the "Live demo" banner.
- `/dashboard` shows charts with mock numbers, theme toggle works.
- `/runs/run_demo_1` streams fake events (~1/s) into timeline/tool panels.
- `/findings` + `/findings/finding_demo_1` renders with PoC, markdown.
- `/admin/*` pages render (platform-admin role in demo).

### 2. Local full-stack (Docker compose)

```bash
cd deploy
cp .env.example .env
# set STRIX_DOMAIN=localhost, STRIX_TLS_EMAIL=internal,
# POSTGRES_PASSWORD=<anything>, LLM_MODEL=<...>, LLM_API_KEY=<...>
docker compose up -d --build
```

Expected:

- `docker compose ps` → all services `healthy` within ~2 min.
- `curl -k https://localhost/healthz` → `200 {"status":"ok"}`.
- `curl -k https://localhost/api/runs` → `200 []` (or existing runs).
- Frontend at `https://localhost` can create a run via the UI.

### 3. Resume smoke test

1. Start a run via the UI (small target).
2. `docker compose restart api`.
3. Confirm the run's page continues streaming within 10 seconds and the
   dashboard status moves from `running` → (brief `paused`) → `running`.
4. Confirm a `run.checkpoint` event is present in `strix_runs/<id>/events.jsonl`.

### 4. Rate-limit smoke test

1. Trigger `POST /api/admin/rate-limits` from a platform-admin account.
2. Force a synthetic 429 in `LLMGovernor` (dev hook) — observe
   `llm.throttled` event in the timeline and the throttle banner on dashboard.
3. After cooldown the banner clears and the run resumes automatically.

## Automated test coverage

- `tests/api/test_health.py` — `/healthz`, `/readyz` including flag surface.
- `tests/api/test_runs.py` — list/get/create shape + 404 / 400 contract.
- `tests/api/test_admin_rbac.py` — admin routes reachable for platform-admin,
  will start rejecting once auth is enforced (production startup check).
- Frontend `npm run build` (demo) runs as part of `web-ci.yml`.
- Trivy (fs + both images) + Gitleaks run on every PR.

## Known gaps / follow-ups

- Resume flow currently signals via checkpoint + events, but the full
  re-attach of the subprocess orchestrator is scaffolded rather than fully
  reconstituted — production deployments should pair it with the durable
  Redis locks provided in `services/db.py` for cross-worker leadership.
- Admin observability ships with single-org aggregation in file-only mode;
  multi-org analytics activate automatically once Postgres is configured.
- End-to-end Playwright smoke tests for the dashboard are scaffolded in the
  plan but intentionally deferred so the dev loop stays lightweight.
