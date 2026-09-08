"""Launch Strix scans as background jobs.

The CLI entry (``strix/interface/main.py``) already wires the whole runtime;
we reuse it by spawning the ``strix`` CLI as a subprocess in non-interactive
mode so we do not duplicate orchestration logic. Each run writes into
``<runs_dir>/<run_name>/``.

Responsibilities:

* ``start`` — spawn the CLI, capture stdout/stderr to ``runner.log`` in the
  run directory, and register an exit-watcher thread so we can surface
  crashes to the UI even if the subprocess never produced an ``events.jsonl``
  entry (missing ``STRIX_LLM``, unreachable sandbox image, etc.).
* ``stop`` — SIGTERM the subprocess. Works across requests by consulting the
  pidfile when the in-process handle has been dropped (for example when a
  previous process instance handled ``start`` and a replica picks up
  ``stop``).
* ``active_snapshot`` — expose live runs to the system health dashboard.

A single ``RunLauncher`` instance is shared process-wide via
:func:`get_run_launcher` so the handle bookkeeping survives across API
requests. The class is import-time safe; nothing mutates on import.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_\-]")

# Path inside the run directory that captures the CLI's stdout/stderr. Limited
# to a few MB in rotation so crashlooping runs can't fill the disk.
_RUNNER_LOG = "runner.log"

# Hard upper bound for runner.log payload we surface back to the UI.
_LOG_TAIL_CHARS = 4000


def _sanitize(name: str) -> str:
    return _SAFE_NAME_RE.sub("-", name)[:64] or "run"


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class ActiveRun:
    run_id: str
    process: subprocess.Popen[bytes]
    started_at: float
    targets: list[str]
    log_path: Path


class RunLauncher:
    def __init__(self, runs_dir: str | Path):
        self.runs_dir = Path(runs_dir)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self._active: dict[str, ActiveRun] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ start

    def start(
        self,
        *,
        targets: list[str],
        instruction: str | None,
        scan_mode: str,
        scope_mode: str,
        env: dict[str, str] | None = None,
    ) -> ActiveRun:
        """Start a non-interactive Strix CLI run and return a handle."""
        run_id = f"run-{_sanitize(targets[0] if targets else 'scan')}-{int(time.time())}"

        cmd = [
            "strix",
            "--run-name",
            run_id,
            "--non-interactive",
            "--scan-mode",
            scan_mode,
        ]
        if scope_mode:
            cmd.extend(["--scope-mode", scope_mode])
        for t in targets:
            cmd.extend(["--target", t])
        if instruction:
            cmd.extend(["--instruction", instruction])

        full_env = os.environ.copy()
        # Overlay the LLM config the user saved via /api/llm/config. This is
        # what carries Ollama Cloud / OpenAI / Anthropic credentials from the
        # dashboard Settings page into the CLI subprocess. Without it, the
        # subprocess sees only the deploy/.env values (often empty).
        try:
            from strix.api.services.llm_config import env_dict, get_store

            llm_cfg = get_store(self.runs_dir).effective()
            for key, value in env_dict(llm_cfg).items():
                if value:
                    full_env[key] = value
        except Exception as exc:
            logger.warning("run_launcher: LLM config overlay skipped: %s", exc)
        if env:
            full_env.update(env)
        # Back-compat shim: operators frequently set ``LLM_MODEL`` because our
        # older docs used that name. The CLI actually reads ``STRIX_LLM`` via
        # :class:`strix.config.Config`. Translate silently so both work.
        if not full_env.get("STRIX_LLM") and full_env.get("LLM_MODEL"):
            full_env["STRIX_LLM"] = full_env["LLM_MODEL"]

        # Prepare the run directory *before* spawning so we can capture logs
        # even if the subprocess crashes during import.
        run_dir = self.runs_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        log_path = run_dir / _RUNNER_LOG

        # The tracer inside the CLI writes events to ``Path.cwd() / strix_runs``.
        # We therefore run the subprocess with cwd = runs_dir.parent so that
        # resolves to ``self.runs_dir`` — keeping the CLI's layout and the
        # API's view aligned without patching tracer internals.
        working_dir = self.runs_dir.parent
        try:
            working_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            # If we can't create/touch the parent (unusual — should already
            # exist because runs_dir does), fall back to runs_dir itself.
            working_dir = self.runs_dir

        # Open the log with line-buffered append so the exit-watcher and
        # operators running ``docker compose exec api tail -f`` both see the
        # stream in real time.
        log_fh = log_path.open("ab", buffering=0)
        try:
            process = subprocess.Popen(  # noqa: S603 — controlled command
                cmd,
                cwd=str(working_dir),
                env=full_env,
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            log_fh.close()
            self._write_synthetic_failure(
                run_dir,
                run_id,
                targets,
                scan_mode,
                scope_mode,
                reason=f"strix CLI not found on PATH: {exc}",
            )
            raise
        except OSError as exc:
            log_fh.close()
            self._write_synthetic_failure(
                run_dir,
                run_id,
                targets,
                scan_mode,
                scope_mode,
                reason=f"Failed to spawn strix: {exc}",
            )
            raise

        handle = ActiveRun(
            run_id=run_id,
            process=process,
            started_at=time.time(),
            targets=list(targets),
            log_path=log_path,
        )
        with self._lock:
            self._active[run_id] = handle

        self._write_pidfile(run_id, process.pid, " ".join(shlex.quote(p) for p in cmd))
        self._write_run_metadata(
            run_dir,
            run_id=run_id,
            targets=targets,
            scan_mode=scan_mode,
            scope_mode=scope_mode,
            instruction=instruction,
        )
        self._initialize_pipeline(run_dir)

        # Exit watcher: if the CLI dies before writing an events.jsonl line we
        # still want the UI to reflect "failed" (instead of "queued forever").
        # Watcher is best-effort; never propagate exceptions to the caller.
        watcher = threading.Thread(
            target=self._watch_exit,
            args=(handle, run_dir, log_fh),
            name=f"strix-exit-watcher-{run_id}",
            daemon=True,
        )
        watcher.start()
        return handle

    # ------------------------------------------------------------------- stop

    def stop(self, run_id: str) -> bool:
        """SIGTERM the run. Falls back to the pidfile for cross-process stop."""
        return self._signal(run_id, signal.SIGTERM)

    def kill(self, run_id: str) -> bool:
        """SIGKILL the run — terminal, no graceful shutdown window."""
        sig = getattr(signal, "SIGKILL", signal.SIGTERM)
        return self._signal(run_id, sig)

    def pause(self, run_id: str) -> bool:
        """SIGSTOP the run so agent work halts in-place without losing state.

        On POSIX, SIGSTOP / SIGCONT give us in-kernel suspend semantics that
        Python can't ignore, which is exactly what we want for mid-run holds
        (the agent doesn't need to cooperate; the OS just freezes the
        process tree). Windows hosts fall back to a no-op — the launcher
        never targets Windows for the sandbox anyway.
        """
        if not hasattr(signal, "SIGSTOP"):
            return False
        return self._signal(run_id, signal.SIGSTOP)

    def resume(self, run_id: str) -> bool:
        """SIGCONT the run — undoes a prior :meth:`pause`."""
        if not hasattr(signal, "SIGCONT"):
            return False
        return self._signal(run_id, signal.SIGCONT)

    def restart(self, run_id: str) -> ActiveRun | None:
        """Relaunch a run using its persisted ``run.meta.json`` settings.

        Returns the new :class:`ActiveRun` handle on success, ``None`` when
        metadata is missing/invalid or restart fails.
        """
        meta = self._read_run_metadata(run_id)
        if not meta:
            return None

        targets = meta.get("targets")
        if not isinstance(targets, list) or not targets:
            return None
        normalized_targets = [str(t) for t in targets if str(t).strip()]
        if not normalized_targets:
            return None

        scan_mode = str(meta.get("scan_mode") or "deep")
        scope_mode = str(meta.get("scope_mode") or "auto")
        instruction_raw = meta.get("instruction")
        instruction = str(instruction_raw) if isinstance(instruction_raw, str) else None
        instruction = self._build_restart_instruction(run_id, instruction)

        # Best effort: if the original run is still active, stop it first.
        self.stop(run_id)
        return self.start(
            targets=normalized_targets,
            instruction=instruction,
            scan_mode=scan_mode,
            scope_mode=scope_mode,
        )

    def _signal(self, run_id: str, sig: int) -> bool:
        with self._lock:
            handle = self._active.get(run_id)
        if handle is not None:
            try:
                handle.process.send_signal(sig)
                return True
            except OSError:
                pass

        pid = self._read_pid(run_id)
        if pid is None:
            return False
        try:
            os.kill(pid, sig)
            return True
        except (OSError, ProcessLookupError):
            return False

    # ------------------------------------------------------------- bookkeeping

    def is_active(self, run_id: str) -> bool:
        with self._lock:
            h = self._active.get(run_id)
        if h is not None:
            if h.process.poll() is None:
                return True
            with self._lock:
                self._active.pop(run_id, None)
            return False
        pid = self._read_pid(run_id)
        if pid is None:
            return False
        try:
            os.kill(pid, 0)
        except (OSError, ProcessLookupError):
            return False
        return True

    def active_snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "run_id": h.run_id,
                    "pid": h.process.pid,
                    "started_at": h.started_at,
                    "targets": h.targets,
                }
                for h in self._active.values()
                if h.process.poll() is None
            ]

    # --------------------------------------------------------------- internal

    def _write_pidfile(self, run_id: str, pid: int, command: str) -> None:
        target = self.runs_dir / run_id
        target.mkdir(parents=True, exist_ok=True)
        (target / "run.pid").write_text(f"{pid}\n{command}\n", encoding="utf-8")

    def _read_pid(self, run_id: str) -> int | None:
        path = self.runs_dir / run_id / "run.pid"
        if not path.is_file():
            return None
        try:
            first = path.read_text(encoding="utf-8").splitlines()[0].strip()
            return int(first) if first else None
        except (OSError, ValueError, IndexError):
            return None

    def _read_run_metadata(self, run_id: str) -> dict[str, Any]:
        path = self.runs_dir / run_id / "run.meta.json"
        if not path.is_file():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return raw if isinstance(raw, dict) else {}

    def _build_restart_instruction(self, run_id: str, base_instruction: str | None) -> str | None:
        """Augment restart instructions with key context from the previous run.

        This preserves operator intent while giving the new run memory of what
        was already tried (commands/tools/findings/report summary).
        """
        run_dir = self.runs_dir / run_id
        events_path = run_dir / "events.jsonl"
        report_path = run_dir / "penetration_test_report.md"

        tool_lines: list[str] = []
        finding_lines: list[str] = []
        user_lines: list[str] = []

        if events_path.is_file():
            try:
                with events_path.open("r", encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        et = str(rec.get("event_type") or "")
                        payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
                        actor = rec.get("actor") if isinstance(rec.get("actor"), dict) else {}

                        if et == "tool.execution.started":
                            tool_name = str(actor.get("tool_name") or "tool")
                            raw_args = payload.get("args")
                            args: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}
                            # Capture the most useful "what did we run" fields.
                            cmd = (
                                args.get("command")
                                or args.get("input")
                                or args.get("url")
                                or args.get("query")
                            )
                            if cmd:
                                tool_lines.append(f"- {tool_name}: {cmd!s}")
                            else:
                                tool_lines.append(f"- {tool_name}")
                        elif et == "finding.created":
                            raw_report = payload.get("report")
                            report: dict[str, Any] = (
                                raw_report if isinstance(raw_report, dict) else {}
                            )
                            title = str(report.get("title") or payload.get("title") or "").strip()
                            sev = str(
                                report.get("severity") or payload.get("severity") or ""
                            ).strip()
                            target = str(report.get("target") or "").strip()
                            if title:
                                suffix = f" ({sev})" if sev else ""
                                tgt = f" @ {target}" if target else ""
                                finding_lines.append(f"- {title}{suffix}{tgt}")
                        elif et == "chat.message":
                            role = str(actor.get("role") or "").lower()
                            content = str(payload.get("content") or "").strip()
                            if role == "user" and content:
                                user_lines.append(f"- {content}")
            except OSError:
                pass

        report_excerpt = ""
        if report_path.is_file():
            try:
                text = report_path.read_text(encoding="utf-8")
                report_excerpt = text[:2000].strip()
            except OSError:
                report_excerpt = ""

        # Keep only recent/high-signal context to avoid over-inflating prompt.
        tool_lines = tool_lines[-20:]
        finding_lines = finding_lines[-15:]
        user_lines = user_lines[-10:]

        restart_context_parts: list[str] = []
        if user_lines:
            restart_context_parts.append(
                "Recent operator messages from previous run:\n" + "\n".join(user_lines)
            )
        if tool_lines:
            restart_context_parts.append(
                "Recent tool/command activity from previous run:\n" + "\n".join(tool_lines)
            )
        if finding_lines:
            restart_context_parts.append(
                "Findings observed in previous run:\n" + "\n".join(finding_lines)
            )
        if report_excerpt:
            restart_context_parts.append(
                "Previous report excerpt (truncate-safe):\n" + report_excerpt
            )

        if not restart_context_parts:
            return base_instruction

        memory_block = (
            "\n\n[RESTART MEMORY CONTEXT]\n"
            "You are restarting a prior run. Reuse this context to avoid repeating\n"
            "identical dead-end steps, and continue from the highest-value next actions.\n\n"
            + "\n\n".join(restart_context_parts)
        )

        if base_instruction:
            return f"{base_instruction.strip()}{memory_block}"
        return (
            "Continue this target with awareness of previous attempts and prioritize\n"
            "new attack paths over repeated checks." + memory_block
        )

    def _write_run_metadata(
        self,
        run_dir: Path,
        *,
        run_id: str,
        targets: list[str],
        scan_mode: str,
        scope_mode: str,
        instruction: str | None,
    ) -> None:
        """Write a ``run.meta.json`` + initial events.jsonl entry so the
        dashboard has a queued-state snapshot even before the tracer boots.
        """
        meta = {
            "run_id": run_id,
            "run_name": run_id,
            "targets": list(targets),
            "scan_mode": scan_mode,
            "scope_mode": scope_mode,
            "instruction": instruction,
            "queued_at": _iso_now(),
        }
        try:
            (run_dir / "run.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        except OSError as exc:
            logger.warning("run_launcher: failed to write run.meta.json: %s", exc)
            return

        # Prime events.jsonl so list()/get() show the run in "queued" state
        # immediately. The tracer will append real events next to this one.
        events_path = run_dir / "events.jsonl"
        if events_path.exists():
            return
        primer = {
            "event_type": "run.configured",
            "timestamp": _iso_now(),
            "actor": None,
            "payload": {"scan_mode": scan_mode, "scope_mode": scope_mode},
            "run_metadata": meta,
        }
        try:
            with events_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(primer) + "\n")
        except OSError as exc:
            logger.warning("run_launcher: failed to prime events.jsonl: %s", exc)

    def _watch_exit(
        self,
        handle: ActiveRun,
        run_dir: Path,
        log_fh: Any,
    ) -> None:
        rc = handle.process.wait()
        try:
            log_fh.close()
        except Exception:
            pass

        with self._lock:
            self._active.pop(handle.run_id, None)

        # Backstop sandbox cleanup. The CLI normally tears down its own
        # sandbox via atexit + signal handlers, but those don't fire on
        # SIGKILL or when the subprocess crashes mid-import. Without this
        # sweep, killed runs leave 4GB sandboxes alive and the host runs out
        # of RAM after a handful of failed scans (which is exactly the bug
        # the user hit — 3 zombies starving the 4th run of memory).
        self._reap_sandbox_container(handle.run_id)

        # The CLI uses a quirky exit-code convention:
        #   0  -> clean finish, no findings
        #   2  -> clean finish, vulnerabilities found
        #   *  -> crash / argparse error / sandbox failure
        # Additionally, the tracer writes a ``run.completed`` event as soon as
        # the scan finishes, so the most reliable signal is "did the tracer
        # mark completion?" rather than the raw exit code. If it did, trust
        # it regardless of the exit code. Otherwise treat the exit as a crash
        # and surface the tail of runner.log so the UI can show *why*.
        if self._has_completion_event(run_dir):
            return

        tail = self._tail_log(run_dir / _RUNNER_LOG)
        reason = f"strix CLI exited with code {rc} before emitting a completion event"
        if tail:
            reason = f"{reason}\n---\n{tail}"
        logger.warning(
            "run_launcher: run %s exited with code %d without completion event",
            handle.run_id,
            rc,
        )
        self._append_event(
            run_dir,
            {
                "event_type": "run.failed",
                "timestamp": _iso_now(),
                "actor": None,
                "payload": {"exit_code": rc, "reason": reason},
                "status": "failed",
            },
        )

    @staticmethod
    def _reap_sandbox_container(run_id: str) -> None:
        """Force-remove the run's sandbox container if it's still around.

        Idempotent and best-effort: silently no-ops when the container is
        already gone or Docker is unreachable. Mirrors the naming convention
        used by ``DockerRuntime._create_container`` (``strix-scan-{run_id}``)
        and the ``strix-scan-id`` label so we catch both naming paths.
        """

        try:
            import docker
            from docker.errors import DockerException, NotFound
        except ImportError:
            return

        try:
            client = docker.from_env(timeout=10)
        except Exception:
            return

        # By name first (cheapest). Fall back to label lookup so we still
        # catch containers spawned with a non-default naming scheme.
        try:
            container = client.containers.get(f"strix-scan-{run_id}")
            try:
                container.remove(force=True, v=True)
                logger.info("reaped sandbox container for run %s", run_id)
            except (DockerException, NotFound):
                pass
            return
        except NotFound:
            pass
        except DockerException:
            return

        try:
            for c in client.containers.list(all=True, filters={"label": f"strix-scan-id={run_id}"}):
                try:
                    c.remove(force=True, v=True)
                    logger.info("reaped labelled sandbox container for run %s", run_id)
                except (DockerException, NotFound):
                    continue
        except DockerException:
            return

    @staticmethod
    def _has_completion_event(run_dir: Path) -> bool:
        """Return True if events.jsonl contains a scan/run completion marker.

        Used to decide whether a non-zero exit is a real crash or the CLI's
        convention of ``sys.exit(2)`` when the scan finished with findings.
        """
        path = run_dir / "events.jsonl"
        if not path.is_file():
            return False
        try:
            # The completion event is always late in the file, so scan from
            # the tail rather than the head to keep this cheap on long runs.
            with path.open("rb") as fh:
                fh.seek(0, os.SEEK_END)
                size = fh.tell()
                window = min(size, 64 * 1024)
                fh.seek(size - window, os.SEEK_SET)
                chunk = fh.read().decode("utf-8", errors="replace")
            for line in reversed(chunk.splitlines()):
                if not line.strip():
                    continue
                try:
                    evt = json.loads(line)
                except ValueError:
                    continue
                et = evt.get("event_type") or evt.get("type") or ""
                if et in {"run.completed", "scan.completed", "run.finished"}:
                    return True
                if evt.get("payload", {}).get("scan_completed") is True:
                    return True
        except OSError:
            return False
        return False

    def _write_synthetic_failure(
        self,
        run_dir: Path,
        run_id: str,
        targets: list[str],
        scan_mode: str,
        scope_mode: str,
        *,
        reason: str,
    ) -> None:
        self._write_run_metadata(
            run_dir,
            run_id=run_id,
            targets=targets,
            scan_mode=scan_mode,
            scope_mode=scope_mode,
            instruction=None,
        )
        self._append_event(
            run_dir,
            {
                "event_type": "run.failed",
                "timestamp": _iso_now(),
                "actor": None,
                "payload": {"reason": reason},
                "status": "failed",
            },
        )

    @staticmethod
    def _initialize_pipeline(run_dir: Path) -> None:
        """Seed the pipeline state machine with the ``configured`` stage.

        Called once after we know the subprocess launched. Keeps the initial
        transition consistent across CLI- and API-launched runs.
        """
        try:
            from strix.core.pipeline_contracts import (
                STAGE_CONFIGURED,
                PipelineController,
            )

            PipelineController(run_dir).enter(STAGE_CONFIGURED, reason="run_launcher.start")
        except Exception as exc:
            logger.warning("run_launcher: could not initialize pipeline state: %s", exc)

    @staticmethod
    def _append_event(run_dir: Path, event: dict[str, Any]) -> None:
        try:
            with (run_dir / "events.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(event) + "\n")
        except OSError as exc:  # pragma: no cover - best effort
            logger.warning("run_launcher: failed to append event: %s", exc)

    @staticmethod
    def _tail_log(path: Path) -> str:
        if not path.is_file():
            return ""
        try:
            size = path.stat().st_size
            with path.open("rb") as fh:
                if size > _LOG_TAIL_CHARS:
                    fh.seek(-_LOG_TAIL_CHARS, os.SEEK_END)
                data = fh.read()
            return data.decode("utf-8", errors="replace")
        except OSError:
            return ""


# Module-level singleton so ``start`` and ``stop`` can share the handle table
# even though FastAPI instantiates the route-level dependency per request.
_LAUNCHER: RunLauncher | None = None
_LAUNCHER_LOCK = threading.Lock()


def get_run_launcher(runs_dir: str | Path) -> RunLauncher:
    """Return the process-wide RunLauncher bound to ``runs_dir``."""
    global _LAUNCHER
    with _LAUNCHER_LOCK:
        if _LAUNCHER is None or Path(_LAUNCHER.runs_dir) != Path(runs_dir):
            _LAUNCHER = RunLauncher(runs_dir)
        return _LAUNCHER
