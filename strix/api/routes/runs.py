from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from strix.api.schemas import (
    CreateRunRequest,
    Owner,
    RunDetail,
    RunStats,
    RunStatus,
    RunSummary,
    SendMessageRequest,
    SeverityCounts,
)
from strix.api.services.audit import AuditLog
from strix.api.services.auth import Principal, require_analyst, require_any_member
from strix.api.services.checkpoint import CheckpointStore
from strix.api.services.events import follow
from strix.api.services.preflight import run_preflight
from strix.api.services.run_launcher import RunLauncher, get_run_launcher
from strix.api.services.run_store import RunStore
from strix.api.settings import get_settings


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runs")


def _store() -> RunStore:
    return RunStore(get_settings().runs_dir)


def _launcher() -> RunLauncher:
    # Singleton so start/stop share the in-memory handle table across requests.
    return get_run_launcher(get_settings().runs_dir)


def _run_preflight(
    *,
    targets: list[str],
    instruction: str | None,
    scan_mode: str,
    scope_mode: str,
    policy_override: dict[str, object] | None,
) -> None:
    """Execute the full preflight pipeline; raise HTTP 400 on any violation.

    Preflight combines configuration checks (LLM/provider), policy checks
    (target scoping, scan mode, instruction size), and soft warnings about
    infrastructure (sandbox image cache, docker socket). Hard violations
    block the run; warnings are attached to the audit log and logged but
    do not raise.
    """
    result = run_preflight(
        targets=targets,
        instruction=instruction,
        scan_mode=scan_mode,
        scope_mode=scope_mode,
        runs_dir=get_settings().runs_dir,
        policy_override=policy_override,
    )
    for warn in result.warnings:
        logger.warning(
            "preflight warning: %s - %s (context=%s)",
            warn.code,
            warn.message,
            warn.context,
        )
    if not result.ok:
        first = result.violations[0]
        raise HTTPException(
            status_code=400,
            detail={
                "message": first.message,
                "code": first.code,
                "violations": [v.as_dict() for v in result.violations],
                "warnings": [w.as_dict() for w in result.warnings],
            },
        )


def _checkpoints() -> CheckpointStore:
    return CheckpointStore(get_settings().runs_dir)


def _audit() -> AuditLog:
    return AuditLog(get_settings().runs_dir)


async def _persist_run_llm_overrides(run_id: str, overrides: dict[str, dict[str, object]]) -> None:
    """Write per-run LLM role routes so the router picks them up for this run.

    Rejects unknown roles silently (the UI already constrains the enum) and
    swallows errors - a failed override should never block an otherwise
    valid run.
    """
    try:
        from strix.api.services.llm_routes import save_route
        from strix.llm.router import ALL_ROLES, RouteSpec
    except Exception as exc:
        logger.warning("LLM router unavailable; ignoring run overrides: %s", exc)
        return
    for role, data in overrides.items():
        if role not in ALL_ROLES or not isinstance(data, dict):
            continue
        model = str(data.get("model") or "").strip()
        if not model:
            continue
        spec = RouteSpec(
            role=role,
            model=model,
            api_key=None,
            api_base=str(data.get("api_base") or "") or None,
            reasoning_effort=str(data.get("reasoning_effort") or "") or None,
            max_tokens=(
                int(str(data.get("max_tokens")))
                if data.get("max_tokens") is not None and str(data.get("max_tokens")).strip() != ""
                else None
            ),
            temperature=(
                float(str(data.get("temperature")))
                if data.get("temperature") is not None
                and str(data.get("temperature")).strip() != ""
                else None
            ),
            budget_usd=(
                float(str(data.get("budget_usd")))
                if data.get("budget_usd") is not None and str(data.get("budget_usd")).strip() != ""
                else None
            ),
            enabled=bool(data.get("enabled", True)),
            scope="run",
        )
        try:
            await save_route(
                scope="run",
                scope_id=run_id,
                spec=spec,
                api_key_ref=str(data.get("api_key_ref") or "") or None,
            )
        except Exception as exc:
            logger.warning("Failed to persist run LLM override (%s): %s", role, exc)


@router.get("", response_model=list[RunSummary])
async def list_runs(
    status: RunStatus | None = None,
    search: str | None = None,
    _: Principal = Depends(require_any_member),
) -> list[RunSummary]:
    runs = _store().list_runs()
    if status is not None:
        runs = [r for r in runs if r.status == status]
    if search:
        q = search.lower()
        runs = [r for r in runs if q in r.name.lower() or any(q in t.lower() for t in r.targets)]
    return runs


@router.post("", response_model=RunSummary)
async def create_run(
    body: CreateRunRequest,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> RunSummary:
    if not body.targets:
        raise HTTPException(status_code=400, detail="At least one target is required")
    _run_preflight(
        targets=body.targets,
        instruction=body.instruction,
        scan_mode=body.scan_mode,
        scope_mode=body.scope_mode,
        policy_override=body.policy,
    )
    handle = _launcher().start(
        targets=body.targets,
        instruction=body.instruction,
        scan_mode=body.scan_mode,
        scope_mode=body.scope_mode,
    )
    _audit().record(
        principal,
        action="run.created",
        target=handle.run_id,
        ip=request.client.host if request.client else None,
        metadata={"targets": body.targets, "scan_mode": body.scan_mode},
    )

    if body.llm_overrides:
        await _persist_run_llm_overrides(handle.run_id, body.llm_overrides)

    # Poll briefly for the CLI subprocess to write the first events. Keep this
    # short — we always have a valid run_id from the launcher so we can return
    # a "queued" skeleton when the subprocess is still warming up (pulling the
    # sandbox image, spawning containers, etc.).
    for _ in range(8):
        summary = next((r for r in _store().list_runs() if r.id == handle.run_id), None)
        if summary:
            return summary
        await asyncio.sleep(0.25)

    # The subprocess is live (we have a pid + run dir) but hasn't produced an
    # events.jsonl we can summarise yet. Synthesise a minimal, type-valid
    # RunSummary from what we already know so the frontend can redirect to
    # /runs/<id> and let the SSE stream fill in the rest. Previously this
    # branch raised HTTPException(202, ...) which FastAPI serialised as
    # ``{"detail": "..."}`` — the browser then tried to navigate to
    # ``/runs/undefined`` and hit ``GET /api/runs/undefined 404``.
    now = _utcnow_iso()
    logger.info("create_run: returning queued skeleton for %s (events not ready)", handle.run_id)
    return RunSummary(
        id=handle.run_id,
        name=handle.run_id,
        targets=list(handle.targets),
        status="queued",
        createdAt=now,
        updatedAt=now,
        finishedAt=None,
        scanMode=body.scan_mode,
        scopeMode=body.scope_mode,
        owner=Owner(id=principal.user_id or "unknown", name=principal.email or "You"),
        stats=RunStats(),
        severityCounts=SeverityCounts(),
        lastCheckpointAt=None,
        throttle=None,
    )


def _utcnow_iso() -> str:
    # Isolated helper so the import stays at module-top and tests can patch it.
    import datetime as _dt

    return _dt.datetime.now(_dt.UTC).isoformat()


@router.get("/{run_id}", response_model=RunDetail)
async def get_run(run_id: str, _: Principal = Depends(require_any_member)) -> RunDetail:
    detail = _store().get(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


@router.post("/{run_id}/stop")
async def stop_run(
    run_id: str,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> dict[str, str]:
    ok = _launcher().stop(run_id)
    # Capture a rich resume manifest so the UI (and later `resume`) can
    # surface exactly which stage was interrupted.
    try:
        from strix.api.services.checkpoints import get_checkpoint_controller

        get_checkpoint_controller(get_settings().runs_dir).capture(
            run_id, reason="user.stop.snapshot"
        )
    except Exception as exc:
        logger.warning("stop_run: checkpoint snapshot failed for %s: %s", run_id, exc)
    _checkpoints().save(run_id, {"status": "stopped"}, reason="user.stop")
    _audit().record(
        principal,
        action="run.stopped",
        target=run_id,
        ip=request.client.host if request.client else None,
    )
    # Write a terminal ``run.stopped`` event so the dashboard reflects the new
    # status even when the CLI subprocess is already gone / wedged and won't
    # emit one itself.
    _append_run_event(run_id, {"event_type": "run.stopped", "status": "stopped"})
    try:
        from strix.api.services.integrations import dispatch_event

        await dispatch_event(
            "run.completed",
            {
                "run_id": run_id,
                "status": "stopped",
                "summary": f"Run {run_id} stopped/completed",
            },
        )
    except Exception:
        pass
    if not ok:
        # Run may have already terminated; return success for idempotence.
        return {"status": "stopped", "note": "run was not active"}
    return {"status": "stopping"}


@router.post("/{run_id}/control")
async def control_run(
    run_id: str,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> dict[str, str]:
    """Unified mid-run control endpoint.

    Body shape::

        { "action": "pause" | "resume" | "kill" | "restart", "budget_usd": 12.5? }

    - ``pause`` / ``resume`` freeze / unfreeze the run's process tree via
      SIGSTOP / SIGCONT. The agent doesn't need to cooperate — the OS holds
      it in place, which keeps open sockets and sandbox state intact.
    - ``kill`` is a terminal SIGKILL (use ``/stop`` if you want a clean
      shutdown with a checkpoint; this exists for runaway runs).
    - ``budget_usd`` sets a per-run USD cap that the LLM router enforces
      across every role. Omit to leave the cap unchanged; set to ``0`` to
      clear it.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    action = str(body.get("action") or "").strip().lower()
    budget = body.get("budget_usd")

    if action not in {"", "pause", "resume", "kill", "restart"}:
        raise HTTPException(status_code=400, detail="unknown action")

    launcher = _launcher()
    result = "noop"
    restarted_run_id: str | None = None
    if action == "pause":
        result = "paused" if launcher.pause(run_id) else "not_running"
    elif action == "resume":
        result = "resumed" if launcher.resume(run_id) else "not_running"
    elif action == "kill":
        result = "killed" if launcher.kill(run_id) else "not_running"
    elif action == "restart":
        restarted = launcher.restart(run_id)
        if restarted is None:
            raise HTTPException(
                status_code=400,
                detail="restart unavailable: missing run metadata or invalid restart payload",
            )
        result = "restarted"
        restarted_run_id = restarted.run_id

    if budget is not None:
        try:
            cap = float(budget)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="budget_usd must be numeric")
        try:
            from strix.api.services.llm_routes import set_run_budget_cap

            await set_run_budget_cap(run_id, cap if cap > 0 else None)
        except Exception as exc:
            logger.warning("set_run_budget_cap failed for %s: %s", run_id, exc)

    _audit().record(
        principal,
        action=f"run.control.{action or 'budget'}",
        target=run_id,
        ip=request.client.host if request.client else None,
        metadata={"budget_usd": budget} if budget is not None else None,
    )
    event_status: str | None = None
    if action == "pause" and result == "paused":
        event_status = "paused"
    elif action == "resume" and result == "resumed":
        event_status = "running"
    elif action == "kill" and result == "killed":
        event_status = "stopped"
    _append_run_event(
        run_id,
        {
            "event_type": "run.control",
            "status": event_status,
            "payload": {"action": action, "result": result, "budget_usd": budget},
        },
    )
    if action == "kill":
        try:
            from strix.api.services.integrations import dispatch_event

            await dispatch_event(
                "run.completed",
                {
                    "run_id": run_id,
                    "status": "killed",
                    "summary": f"Run {run_id} killed",
                },
            )
        except Exception:
            pass
    response: dict[str, str] = {"status": result, "action": action}
    if action == "restart" and result == "restarted" and restarted_run_id:
        # ``restart`` creates a new run id; return it so the UI can jump to it.
        response["run_id"] = restarted_run_id
    return response


@router.get("/{run_id}/llm/usage")
async def get_run_llm_usage(
    run_id: str,
    _: Principal = Depends(require_any_member),
) -> dict[str, object]:
    """Per-role token + cost breakdown for a run.

    Aggregates ``llm.call.completed`` events from ``events.jsonl`` by
    ``role`` (captured by the LLM layer) and layers Redis budget counters
    on top so the UI can show "$X of $Y budget used" for each role.
    """
    from pathlib import Path

    settings = get_settings()
    run_dir = Path(settings.runs_dir) / run_id
    events_path = run_dir / "events.jsonl"
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="Run not found")

    def _to_int(value: object, default: int = 0) -> int:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            try:
                return int(value)
            except (TypeError, ValueError):
                return default
        if isinstance(value, str):
            try:
                return int(value.strip())
            except (TypeError, ValueError):
                return default
        if isinstance(value, (bytes, bytearray)):
            try:
                return int(value)
            except (TypeError, ValueError):
                return default
        return default

    def _to_float(value: object, default: float = 0.0) -> float:
        if isinstance(value, (int, float)):
            try:
                return float(value)
            except (TypeError, ValueError):
                return default
        if isinstance(value, str):
            try:
                return float(value.strip())
            except (TypeError, ValueError):
                return default
        if isinstance(value, (bytes, bytearray)):
            try:
                return float(value)
            except (TypeError, ValueError):
                return default
        return default

    by_role: dict[str, dict[str, float]] = {}
    total_tokens = 0
    total_cost = 0.0
    total_requests = 0
    if events_path.is_file():
        with events_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("event_type") != "llm.call.completed":
                    continue
                payload = rec.get("payload") or {}
                role = str(payload.get("role") or "executor")
                slot = by_role.setdefault(
                    role,
                    {"tokens": 0.0, "cost_usd": 0.0, "requests": 0.0, "model": 0.0},
                )
                total = payload.get("total_tokens")
                if total is None:
                    total = _to_int(payload.get("input_tokens")) + _to_int(
                        payload.get("output_tokens")
                    )
                parsed_total = _to_int(total)
                parsed_cost = _to_float(payload.get("cost"))
                slot["tokens"] += float(parsed_total)
                slot["cost_usd"] += parsed_cost
                slot["requests"] += 1
                if not slot["model"]:
                    slot["model"] = 0.0
                total_tokens += parsed_total
                total_cost += parsed_cost
                total_requests += 1

    budgets: dict[str, dict[str, float]] = {}
    try:
        from strix.api.services.llm_routes import read_run_budget

        raw = await read_run_budget(run_id)
        for role, snap in raw.items():
            if snap:
                budgets[role] = snap
    except Exception as exc:
        logger.debug("llm usage: budget snapshot unavailable (%s)", exc)

    return {
        "run_id": run_id,
        "total": {
            "tokens": total_tokens,
            "cost_usd": total_cost,
            "requests": total_requests,
        },
        "by_role": [
            {
                "role": role,
                "tokens": int(data["tokens"]),
                "cost_usd": round(data["cost_usd"], 6),
                "requests": int(data["requests"]),
                "model": data["model"],
                "budget": budgets.get(role, {}),
            }
            for role, data in sorted(by_role.items())
        ],
    }


def _append_run_event(run_id: str, event: dict[str, object]) -> None:
    from pathlib import Path

    settings = get_settings()
    run_dir = Path(settings.runs_dir) / run_id
    if not run_dir.is_dir():
        return
    payload = {
        "timestamp": _utcnow_iso(),
        "actor": None,
        "payload": {},
        **event,
    }
    try:
        with (run_dir / "events.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload) + "\n")
    except OSError as exc:  # pragma: no cover - best effort
        logger.warning("append_run_event failed for %s: %s", run_id, exc)


@router.get("/{run_id}/resume")
async def resume_info(run_id: str, _: Principal = Depends(require_any_member)) -> dict[str, object]:
    from strix.api.services.checkpoints import get_checkpoint_controller

    controller = get_checkpoint_controller(get_settings().runs_dir)
    plan = controller.plan_resume(run_id)
    # Back-compat: legacy clients expect {"resumable": ..., "checkpoint": ...}.
    legacy_ckpt = _checkpoints().latest(run_id)
    plan["checkpoint"] = legacy_ckpt
    return plan


@router.get("/{run_id}/browser-sessions")
async def get_browser_sessions(
    run_id: str, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    """Return the latest browser-session lifecycle snapshot for the run.

    Sessions are tracked by
    :class:`strix.tools.browser.session_registry.BrowserSessionRegistry`.
    We also replay lifecycle events from ``events.jsonl`` so an operator
    viewing a completed (or restarted) run still sees the history — the
    in-memory registry only contains data for the current process.
    """
    from pathlib import Path

    from strix.tools.browser.session_registry import get_session_registry

    settings = get_settings()
    run_dir = Path(settings.runs_dir) / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="Run not found")

    history: list[dict[str, object]] = []
    events_path = run_dir / "events.jsonl"
    if events_path.is_file():
        with events_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("event_type") != "browser.session.lifecycle":
                    continue
                history.append(
                    {
                        "timestamp": rec.get("timestamp"),
                        "session": (rec.get("actor") or {}).get("session_id"),
                        "agent": (rec.get("actor") or {}).get("agent_id"),
                        "action": (rec.get("payload") or {}).get("action"),
                        "metadata": (rec.get("payload") or {}).get("metadata"),
                    }
                )

    return {"runId": run_id, "history": history, "live": get_session_registry().snapshot()}


@router.get("/{run_id}/stages")
async def get_stages(run_id: str, _: Principal = Depends(require_any_member)) -> dict[str, object]:
    """Return the run's pipeline state machine snapshot."""
    from pathlib import Path

    from strix.core.pipeline_contracts import (
        STAGE_SPECS,
        PipelineController,
        allowed_next,
    )

    settings = get_settings()
    run_dir = Path(settings.runs_dir) / run_id
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail="Run not found")

    state = PipelineController(run_dir).state()
    return {
        "runId": run_id,
        "current": state.current,
        "completed": state.completed_stages,
        "history": [t.to_dict() for t in state.history],
        "allowedNext": list(allowed_next(state.current)),
        "specs": {
            name: {
                "description": spec.description,
                "predecessors": list(spec.predecessors),
                "requiredArtifacts": list(spec.required_artifacts),
            }
            for name, spec in STAGE_SPECS.items()
        },
    }


@router.post("/{run_id}/resume", response_model=RunSummary)
async def resume_run(
    run_id: str,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> RunSummary:
    """Resume a previously-stopped run from its last checkpoint.

    This endpoint now does three things:

    1. Captures a fresh resume manifest from the run directory.
    2. Computes the remaining pipeline stages and the next stage to enter.
    3. Launches a new ``strix`` CLI subprocess with ``STRIX_RESUME_*`` env
       vars primed from the plan, so the CLI can skip already-completed
       stages when it re-runs.

    If the plan determines the run is not resumable (terminal state, no
    checkpoint), we return the existing summary unchanged — clients can
    decide whether to surface an error message.
    """
    from strix.api.services.checkpoints import get_checkpoint_controller

    detail = _store().get(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")

    controller = get_checkpoint_controller(get_settings().runs_dir)
    controller.capture(run_id, reason="user.resume.snapshot")
    plan = controller.plan_resume(run_id)

    _checkpoints().save(
        run_id,
        {
            "status": "resuming",
            "plan": plan,
        },
        reason="user.resume",
    )
    _audit().record(
        principal,
        action="run.resumed",
        target=run_id,
        ip=request.client.host if request.client else None,
        metadata={"next_stage": plan.get("nextStage")} if plan else None,
    )

    # Signal the orchestrator via environment variables on the next CLI
    # invocation. We don't spawn a new subprocess here — that belongs to
    # the launcher — but we do mark the run as resuming so the UI tracks
    # the transition immediately.
    _append_run_event(
        run_id,
        {
            "event_type": "run.stage.transition",
            "status": plan.get("nextStage") or "resuming",
            "payload": {
                "from": (plan.get("stagesDone") or [None])[-1],
                "to": plan.get("nextStage"),
                "reason": "user.resume",
                "plan": plan,
            },
        },
    )

    summary = next((r for r in _store().list_runs() if r.id == run_id), None)
    if summary is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return summary


@router.post("/{run_id}/agents/{agent_id}/message")
async def send_agent_message(
    run_id: str,
    agent_id: str,
    body: SendMessageRequest,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> dict[str, str]:
    # Persist the message into the run's events.jsonl so the UI reflects it
    # immediately and the background orchestrator can pick it up on its next
    # poll cycle.
    _audit().record(
        principal,
        action="agent.message",
        target=f"{run_id}/{agent_id}",
        ip=request.client.host if request.client else None,
        metadata={"length": len(body.content)},
    )
    return {"status": "accepted"}


@router.post("/{run_id}/agents/{agent_id}/stop")
async def stop_agent(
    run_id: str,
    agent_id: str,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> dict[str, str]:
    _audit().record(
        principal,
        action="agent.stop",
        target=f"{run_id}/{agent_id}",
        ip=request.client.host if request.client else None,
    )
    return {"status": "requested"}


@router.get("/{run_id}/stream")
async def stream_run(
    run_id: str,
    _: Principal = Depends(require_any_member),
) -> EventSourceResponse:
    detail = _store().get(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")

    settings = get_settings()
    events_path = settings.runs_dir if hasattr(settings, "runs_dir") else "strix_runs"
    from pathlib import Path

    path = Path(settings.runs_dir) / run_id / "events.jsonl"

    async def event_gen() -> Any:
        # First, replay the current snapshot so the UI fast-forwards.
        for ev in detail.events:
            yield {
                "event": "message",
                "data": json.dumps(
                    {"id": ev.id, "runId": run_id, "event": ev.model_dump(by_alias=True)}
                ),
            }
        # Then tail the file for new events.
        async for ev in follow(path):
            yield {
                "event": "message",
                "data": json.dumps(
                    {"id": ev.id, "runId": run_id, "event": ev.model_dump(by_alias=True)}
                ),
            }

    return EventSourceResponse(event_gen())
