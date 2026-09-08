# NovaHunter Change Log

This document summarizes all implementation work completed in this execution cycle to close Pentest-Copilot parity gaps.

Last updated: **2026-04-24**

## Today's Update (2026-04-24)

- Completed all remaining parity phases and cross-cutting items.
- Added final hardening for MCP persistence (`Postgres + file fallback`) and Burp route execution via real tool calls.
- Added/updated MCP server-client surfaces, VPN/Burp/racer/engagement tooling, and UI links/tabs.
- Added test scaffolding for MCP routes, Burp routes, and capabilities tools.
- Added this consolidated change log for full execution traceability.

## Completed Phases Overview

- Phase 0: Sandbox image/runtime/sidechannels foundations
- Phase 1: Quick-win safety and agent guardrails
- Phase 2: Persistent shells (tools + API + UI)
- Phase 3: Live Browser (noVNC) tab
- Phase 4: Netcat tools + listeners UI
- Phase 5: Burp CE integration (coexisting with Caido)
- Phase 6: Capability installer registry + pre-install picker
- Phase 7: Swarm/racer lane helpers
- Phase 8: VPN profile upload/status APIs
- Phase 9: Slash-command parser + Command Palette
- Phase 10: Engagement-state tools
- Phase 11: Role-based LLM router + telemetry + admin controls
- Phase 12: `setup.sh` and `.env.example` refresh
- Phase 13: Canonical reporting schema/templates + exports
- Phase 14: Provider layer + encrypted secrets + LLM settings UX
- Phase 15: Finding lifecycle/dedup + schedules + integrations + run controls + retention + politeness
- Phase 16: MCP server/client support + docs
- Cross-cutting: docs additions, smoke checks, and test scaffolding

---

## Detailed Changes

## Phase 0: Sandbox Image, Runtime, and Sidechannels

- Rebuilt sandbox image with GUI and sidechannel tooling in `containers/Dockerfile`.
- Added process supervision in `containers/supervisord.conf`.
- Added tool inventory in `containers/tools-registry.yaml`.
- Updated startup process in `containers/docker-entrypoint.sh`.
- Added GHCR build workflow in `.github/workflows/sandbox-image.yml`.
- Switched deploy image defaults to GHCR in `deploy/docker-compose.yml`.
- Expanded runtime sidechannel ports and caps in:
  - `strix/runtime/runtime.py`
  - `strix/runtime/docker_runtime.py`
- Added signed sidechannel endpoint in `strix/api/routes/sidechannels.py`.
- Added Caddy passthrough routing for sidechannels in `deploy/Caddyfile`.

## Phase 1: Quick Win Guardrails

- Added dangerous-command policy guard path in:
  - `strix/tools/executor.py`
  - `strix/api/services/policy.py`
- Added per-turn iteration cap in:
  - `strix/llm/config.py`
  - agent loop logic under `strix/agents/*`
- Added `view_image` tool for multimodal inputs:
  - `strix/tools/vision/view_image_actions.py`

## Phase 2: Persistent Shells

- Added shell tools package:
  - `strix/tools/shells/shells_actions.py`
  - `strix/tools/shells/shells_actions_schema.xml`
  - `strix/tools/shells/__init__.py`
- Registered shell tools in `strix/tools/__init__.py`.
- Added REST + WS API routes in `strix/api/routes/shells.py`.
- Wired routes in `strix/api/app.py`.
- Added terminal UI with xterm in:
  - `frontend/src/components/runs/shell-tabs.tsx`
  - `frontend/src/app/(app)/runs/[runId]/page.tsx`
- Added frontend dependencies in `frontend/package.json` (`xterm`, `@xterm/addon-fit`).

## Phase 3: Live Browser

- Added noVNC embedded tab in `frontend/src/app/(app)/runs/[runId]/page.tsx`.

## Phase 4: Netcat

- Added netcat tools:
  - `strix/tools/netcat/netcat_actions.py`
  - `strix/tools/netcat/netcat_actions_schema.xml`
  - `strix/tools/netcat/__init__.py`
- Exposed listener management in API under run-scoped shell routes.
- Added Listeners UI card in terminal/runs experience.

## Phase 5: Burp + Caido Coexistence

- Added Burp tools:
  - `strix/tools/burp/burp_actions.py`
  - `strix/tools/burp/burp_actions_schema.xml`
  - `strix/tools/burp/__init__.py`
- Registered Burp tools in `strix/tools/__init__.py`.
- Added Burp routes in `strix/api/routes/burp.py` and wired via `strix/api/app.py`.
- Added frontend provider methods for Burp history in:
  - `frontend/src/lib/api/provider.ts`
  - `frontend/src/lib/api/api-provider.ts`
  - `frontend/src/lib/api/demo-provider.ts`
- Added Burp tab UI in `frontend/src/app/(app)/runs/[runId]/page.tsx`.
- Hardening update: Burp endpoints now call real Burp tool actions, not static stubs.

## Phase 6: Capability Installer

- Added capability registry:
  - `strix/capabilities/registry.yaml`
- Added capability tools:
  - `strix/tools/capabilities/install_capability_actions.py`
  - `strix/tools/capabilities/__init__.py`
- Registered tools in `strix/tools/__init__.py`.
- Added pre-install selection in new-run UI:
  - `frontend/src/app/(app)/runs/new/page.tsx`

## Phase 7: Swarm / Racer

- Added racer lane helpers in `strix/tools/agents_graph/agents_graph_actions.py`:
  - `create_racer_lane`
  - `list_racer_lanes`

## Phase 8: VPN

- Added VPN APIs in `strix/api/routes/vpn.py`:
  - profile upload
  - status check
- Wired in `strix/api/app.py`.

## Phase 9: Slash Commands + Command Palette

- Added parser and UI component:
  - `frontend/src/components/runs/command-palette.tsx`
- Integrated into run page:
  - `frontend/src/app/(app)/runs/[runId]/page.tsx`

## Phase 10: Engagement State

- Added engagement tools:
  - `strix/tools/engagement/engagement_state_actions.py`
  - `strix/tools/engagement/__init__.py`
- Registered in `strix/tools/__init__.py`.

## Phase 11: LLM Router Core and Controls

- Implemented role-based router and route specs in `strix/llm/router.py`.
- Threaded role usage through LLM call sites across agent/memory/reporting/vision.
- Added persistence:
  - `strix/api/services/llm_routes.py`
  - DB table `strix_llm_routes` in `strix/api/services/db.py`
- Added run-level overrides in run creation and hydration paths.
- Added role cost/token telemetry and run detail UI breakdown:
  - `frontend/src/components/runs/llm-cost-card.tsx`
- Added admin LLM settings experiences and route testing UX.

## Phase 12: Setup and Deployment UX

- Updated installer script in `scripts/setup.sh`:
  - removed clone/install-dir assumptions
  - generated `STRIX_MASTER_KEY`
  - added preflight port checks
  - updated feature summary and image defaults
  - included weasyprint system deps
- Updated env template in `deploy/.env.example`.

## Phase 13: Reporting/Exports

- Added canonical schema and templates for high-quality report output:
  - `docs/report-templates/*`
- Added server renderers in `strix/api/services/report_artifacts.py` for:
  - markdown, plaintext, html, pdf, json, sarif, csv
- Added report export endpoints in `strix/api/routes/findings.py`.
- Replaced client PDF-only approach with export format menu:
  - `frontend/src/components/reports/export-format-menu.tsx`

## Phase 14: Provider Layer + Secrets

- Added provider abstraction under `strix/llm/providers/*`.
- Added AES-GCM encrypted secret storage:
  - `strix/api/services/secrets.py`
- Added/extended LLM settings UI:
  - `frontend/src/app/(app)/settings/llm/page.tsx`
  - linked from `frontend/src/app/(app)/settings/page.tsx`
- Added route health checks and context-window guardrails.

## Phase 15: Run Operations and Findings Lifecycle

- Added dedup/fingerprint support:
  - DB table `strix_finding_fingerprints`
  - integration in `strix/api/services/run_store.py`
- Added finding lifecycle fields/status:
  - `strix/api/schemas.py`
  - triage/retest APIs in `strix/api/routes/findings.py`
- Added recurring schedule system:
  - `strix/api/services/schedules.py`
  - `strix/api/routes/schedules.py`
  - DB table `strix_scan_schedules`
- Added outbound integrations:
  - `strix/api/services/integrations.py`
  - `strix/api/routes/integrations.py`
  - `docs/integrations/outbound.mdx`
- Added run controls and budget cap:
  - `strix/api/services/run_launcher.py`
  - `strix/api/routes/runs.py`
  - `strix/api/services/llm_routes.py`
- Added retention cleanup:
  - `strix/api/services/retention.py`
  - settings in `strix/api/settings.py`
  - startup wiring in `strix/api/app.py`
  - docs in `docs/operations/retention.mdx`
- Added target politeness controls:
  - `strix/api/services/policy.py`
  - `strix/tools/executor.py`

## Phase 16: MCP Server + MCP Client + Docs

- Added MCP server scaffolding:
  - `strix/mcp/server.py`
  - `strix/mcp/__init__.py`
- Added MCP API routes:
  - `strix/api/routes/mcp.py`
- Added MCP client settings UI:
  - `frontend/src/app/(app)/settings/mcp/page.tsx`
- Added provider API methods for MCP:
  - `frontend/src/lib/api/provider.ts`
  - `frontend/src/lib/api/api-provider.ts`
  - `frontend/src/lib/api/demo-provider.ts`
- Added MCP docs:
  - `docs/integrations/mcp.mdx`
- Hardening update:
  - Replaced in-memory MCP storage with durable service `strix/api/services/mcp_registry.py`
  - Added DB tables:
    - `strix_mcp_servers`
    - `strix_mcp_tokens`
  - Added file-backed fallback persistence in `STRIX_RUNS_DIR/.config/mcp_registry.json` when Postgres is unavailable.

## Additional UI/Navigation Improvements

- Added settings-page link to MCP settings:
  - `frontend/src/app/(app)/settings/page.tsx`

## Cross-Cutting Docs and Test Scaffolding

- Added parity closure notes:
  - `docs/features/parity-gaps-closure.mdx`
- Added API tests:
  - `tests/api/test_mcp_routes.py`
  - `tests/api/test_burp_routes.py`
- Added tool tests:
  - `tests/tools/test_capabilities_tool.py`
- Smoke script run success:
  - `python3 scripts/smoke_policy_guard.py` -> `OK: dangerous-command guard passes all cases`
- Note: full pytest run for new API tests requires `fastapi` in the local test env.

---

## Final Status

All previously pending implementation phases and cross-cutting work items have been completed and marked done in the tracked todo list, with a final hardening pass applied for MCP persistence and Burp route execution behavior.
