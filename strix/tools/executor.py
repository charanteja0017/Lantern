import inspect
import os
import threading
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from strix.config import Config
from strix.telemetry import posthog


if os.getenv("STRIX_SANDBOX_MODE", "false").lower() == "false":
    from strix.runtime import get_runtime

from .argument_parser import convert_arguments
from .registry import (
    get_tool_by_name,
    get_tool_names,
    get_tool_param_schema,
    needs_agent_state,
    should_execute_in_sandbox,
)


_SERVER_TIMEOUT = float(Config.get("strix_sandbox_execution_timeout") or "120")
SANDBOX_EXECUTION_TIMEOUT = _SERVER_TIMEOUT + 30
SANDBOX_CONNECT_TIMEOUT = float(Config.get("strix_sandbox_connect_timeout") or "10")


async def execute_tool(tool_name: str, agent_state: Any | None = None, **kwargs: Any) -> Any:
    policy_error = _enforce_policy(tool_name, kwargs)
    if policy_error is not None:
        return policy_error

    execute_in_sandbox = should_execute_in_sandbox(tool_name)
    sandbox_mode = os.getenv("STRIX_SANDBOX_MODE", "false").lower() == "true"
    try:
        if execute_in_sandbox and not sandbox_mode:
            return await _execute_tool_in_sandbox(tool_name, agent_state, **kwargs)
        return await _execute_tool_locally(tool_name, agent_state, **kwargs)
    finally:
        _release_host_slot(kwargs)


_POLICY_CACHE: Any | None = None
_POLITENESS_LOCK = threading.Lock()
_HOST_INFLIGHT: dict[str, int] = {}
_HOST_CALL_TIMES: dict[str, list[float]] = {}


def _enforce_policy(tool_name: str, kwargs: dict[str, Any] | None = None) -> str | None:
    """Return an error string if the active run policy forbids ``tool_name``.

    Runs two checks in order:

    1. ``enforce_tool`` - is the *tool* itself blocked (dry-run-only, blocked
       list, approval required)?
    2. ``enforce_command`` - does the command / code payload match the
       dangerous-command regex deny-list? Only applied when the tool is one of
       the shell / code executors listed in ``COMMAND_KWARG_BY_TOOL``.

    Policy is loaded once per process from the environment; the cache is
    bypassed in sandbox workers where policy enforcement happens in the
    controlling CLI process instead.
    """
    if os.getenv("STRIX_SANDBOX_MODE", "false").lower() == "true":
        return None
    global _POLICY_CACHE
    try:
        if _POLICY_CACHE is None:
            from strix.api.services.policy import load_default_policy

            _POLICY_CACHE = load_default_policy()
        from strix.api.services.policy import (
            enforce_command as _enforce_cmd,
        )
        from strix.api.services.policy import (
            enforce_tool as _enforce,
        )

        violation = _enforce(_POLICY_CACHE, tool_name)
        if violation is None:
            violation = _enforce_cmd(_POLICY_CACHE, tool_name, kwargs)
    except Exception:
        return None
    if violation is None:
        return _reserve_host_slot(_POLICY_CACHE, kwargs)
    return f"Error: {violation.code}: {violation.message}"


def _extract_host_from_kwargs(kwargs: dict[str, Any] | None) -> str | None:
    if not kwargs:
        return None
    for key in ("url", "target", "endpoint", "host", "domain"):
        raw = kwargs.get(key)
        if not isinstance(raw, str) or not raw.strip():
            continue
        text = raw.strip()
        parsed = urlparse(text if "://" in text else f"http://{text}")
        if parsed.hostname:
            return parsed.hostname.lower()
    return None


def _reserve_host_slot(policy: Any, kwargs: dict[str, Any] | None) -> str | None:
    host = _extract_host_from_kwargs(kwargs)
    if not host:
        return None
    max_rps = float(getattr(policy, "max_rps_per_host", 10.0) or 10.0)
    max_concurrency = int(getattr(policy, "max_concurrency_per_host", 4) or 4)
    now = time.monotonic()
    with _POLITENESS_LOCK:
        inflight = _HOST_INFLIGHT.get(host, 0)
        if inflight >= max_concurrency:
            return (
                "Error: policy.target.too_concurrent: "
                f"host '{host}' has {inflight} in-flight actions "
                f"(limit={max_concurrency})."
            )
        current = [ts for ts in _HOST_CALL_TIMES.get(host, []) if now - ts < 1.0]
        if len(current) >= max(1, int(max_rps)):
            return (
                "Error: policy.target.rate_limited: "
                f"host '{host}' exceeded {max_rps:.1f} req/s policy cap."
            )
        current.append(now)
        _HOST_CALL_TIMES[host] = current
        _HOST_INFLIGHT[host] = inflight + 1
    return None


def _release_host_slot(kwargs: dict[str, Any] | None) -> None:
    host = _extract_host_from_kwargs(kwargs)
    if not host:
        return
    with _POLITENESS_LOCK:
        inflight = _HOST_INFLIGHT.get(host, 0)
        if inflight <= 1:
            _HOST_INFLIGHT.pop(host, None)
        else:
            _HOST_INFLIGHT[host] = inflight - 1


async def _execute_tool_in_sandbox(tool_name: str, agent_state: Any, **kwargs: Any) -> Any:
    if not hasattr(agent_state, "sandbox_id") or not agent_state.sandbox_id:
        raise ValueError("Agent state with a valid sandbox_id is required for sandbox execution.")

    if not hasattr(agent_state, "sandbox_token") or not agent_state.sandbox_token:
        raise ValueError(
            "Agent state with a valid sandbox_token is required for sandbox execution."
        )

    if (
        not hasattr(agent_state, "sandbox_info")
        or "tool_server_port" not in agent_state.sandbox_info
    ):
        raise ValueError(
            "Agent state with a valid sandbox_info containing tool_server_port is required."
        )

    runtime = get_runtime()
    tool_server_port = agent_state.sandbox_info["tool_server_port"]
    server_url = await runtime.get_sandbox_url(agent_state.sandbox_id, tool_server_port)
    request_url = f"{server_url}/execute"

    agent_id = getattr(agent_state, "agent_id", "unknown")

    request_data = {
        "agent_id": agent_id,
        "tool_name": tool_name,
        "kwargs": kwargs,
    }

    headers = {
        "Authorization": f"Bearer {agent_state.sandbox_token}",
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(
        timeout=SANDBOX_EXECUTION_TIMEOUT,
        connect=SANDBOX_CONNECT_TIMEOUT,
    )

    async with httpx.AsyncClient(trust_env=False) as client:
        try:
            response = await client.post(
                request_url, json=request_data, headers=headers, timeout=timeout
            )
            response.raise_for_status()
            response_data = response.json()
            if response_data.get("error"):
                posthog.error("tool_execution_error", f"{tool_name}: {response_data['error']}")
                raise RuntimeError(f"Sandbox execution error: {response_data['error']}")
            return response_data.get("result")
        except httpx.HTTPStatusError as e:
            posthog.error("tool_http_error", f"{tool_name}: HTTP {e.response.status_code}")
            if e.response.status_code == 401:
                raise RuntimeError("Authentication failed: Invalid or missing sandbox token") from e
            raise RuntimeError(f"HTTP error calling tool server: {e.response.status_code}") from e
        except httpx.RequestError as e:
            error_type = type(e).__name__
            posthog.error("tool_request_error", f"{tool_name}: {error_type}")
            raise RuntimeError(f"Request error calling tool server: {error_type}") from e


async def _execute_tool_locally(tool_name: str, agent_state: Any | None, **kwargs: Any) -> Any:
    tool_func = get_tool_by_name(tool_name)
    if not tool_func:
        raise ValueError(f"Tool '{tool_name}' not found")

    converted_kwargs = convert_arguments(tool_func, kwargs)

    if needs_agent_state(tool_name):
        if agent_state is None:
            raise ValueError(f"Tool '{tool_name}' requires agent_state but none was provided.")
        result = tool_func(agent_state=agent_state, **converted_kwargs)
    else:
        result = tool_func(**converted_kwargs)

    return await result if inspect.isawaitable(result) else result


def validate_tool_availability(tool_name: str | None) -> tuple[bool, str]:
    if tool_name is None:
        available = ", ".join(sorted(get_tool_names()))
        return False, f"Tool name is missing. Available tools: {available}"

    if tool_name not in get_tool_names():
        available = ", ".join(sorted(get_tool_names()))
        return False, f"Tool '{tool_name}' is not available. Available tools: {available}"

    return True, ""


def _validate_tool_arguments(tool_name: str, kwargs: dict[str, Any]) -> str | None:
    param_schema = get_tool_param_schema(tool_name)
    if not param_schema or not param_schema.get("has_params"):
        return None

    allowed_params: set[str] = param_schema.get("params", set())
    required_params: set[str] = param_schema.get("required", set())
    optional_params = allowed_params - required_params

    schema_hint = _format_schema_hint(tool_name, required_params, optional_params)

    unknown_params = set(kwargs.keys()) - allowed_params
    if unknown_params:
        unknown_list = ", ".join(sorted(unknown_params))
        return f"Tool '{tool_name}' received unknown parameter(s): {unknown_list}\n{schema_hint}"

    missing_required = [
        param for param in required_params if param not in kwargs or kwargs.get(param) in (None, "")
    ]
    if missing_required:
        missing_list = ", ".join(sorted(missing_required))
        return f"Tool '{tool_name}' missing required parameter(s): {missing_list}\n{schema_hint}"

    return None


def _format_schema_hint(tool_name: str, required: set[str], optional: set[str]) -> str:
    parts = [f"Valid parameters for '{tool_name}':"]
    if required:
        parts.append(f"  Required: {', '.join(sorted(required))}")
    if optional:
        parts.append(f"  Optional: {', '.join(sorted(optional))}")
    return "\n".join(parts)


async def execute_tool_with_validation(
    tool_name: str | None, agent_state: Any | None = None, **kwargs: Any
) -> Any:
    is_valid, error_msg = validate_tool_availability(tool_name)
    if not is_valid:
        return f"Error: {error_msg}"

    assert tool_name is not None

    arg_error = _validate_tool_arguments(tool_name, kwargs)
    if arg_error:
        return f"Error: {arg_error}"

    try:
        result = await execute_tool(tool_name, agent_state, **kwargs)
    except Exception as e:
        error_str = str(e)
        if len(error_str) > 500:
            error_str = error_str[:500] + "... [truncated]"
        return f"Error executing {tool_name}: {error_str}"
    else:
        return result


async def execute_tool_invocation(tool_inv: dict[str, Any], agent_state: Any | None = None) -> Any:
    tool_name = tool_inv.get("toolName")
    tool_args = tool_inv.get("args", {})

    return await execute_tool_with_validation(tool_name, agent_state, **tool_args)


def _check_error_result(result: Any) -> tuple[bool, Any]:
    is_error = False
    error_payload: Any = None

    if (isinstance(result, dict) and "error" in result) or (
        isinstance(result, str) and result.strip().lower().startswith("error:")
    ):
        is_error = True
        error_payload = result

    return is_error, error_payload


def _update_tracer_with_result(
    tracer: Any, execution_id: Any, is_error: bool, result: Any, error_payload: Any
) -> None:
    if not tracer or not execution_id:
        return

    try:
        if is_error:
            tracer.update_tool_execution(execution_id, "error", error_payload)
        else:
            tracer.update_tool_execution(execution_id, "completed", result)
    except (ConnectionError, RuntimeError) as e:
        error_msg = str(e)
        if tracer and execution_id:
            tracer.update_tool_execution(execution_id, "error", error_msg)
        raise


def _format_tool_result(tool_name: str, result: Any) -> tuple[str, list[dict[str, Any]]]:
    images: list[dict[str, Any]] = []
    result_str: Any = result

    screenshot_data = extract_screenshot_from_result(result)
    if screenshot_data:
        images.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{screenshot_data}"},
            }
        )
        result_str = remove_screenshot_from_result(result)

    image_b64, image_mime = _extract_image_base64_from_result(result)
    if image_b64 and image_mime:
        images.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image_mime};base64,{image_b64}"},
            }
        )
        result_str = _remove_image_base64_from_result(
            result_str if isinstance(result_str, dict) else result
        )

    if result_str is None:
        final_result_str = f"Tool {tool_name} executed successfully"
    else:
        final_result_str = str(result_str)
        if len(final_result_str) > 10000:
            start_part = final_result_str[:4000]
            end_part = final_result_str[-4000:]
            final_result_str = start_part + "\n\n... [middle content truncated] ...\n\n" + end_part

    observation_xml = (
        f"<tool_result>\n<tool_name>{tool_name}</tool_name>\n"
        f"<result>{final_result_str}</result>\n</tool_result>"
    )

    return observation_xml, images


async def _execute_single_tool(
    tool_inv: dict[str, Any],
    agent_state: Any | None,
    tracer: Any | None,
    agent_id: str,
) -> tuple[str, list[dict[str, Any]], bool]:
    tool_name = tool_inv.get("toolName", "unknown")
    args = tool_inv.get("args", {})
    execution_id = None
    should_agent_finish = False

    if tracer:
        execution_id = tracer.log_tool_execution_start(agent_id, tool_name, args)

    try:
        result = await execute_tool_invocation(tool_inv, agent_state)

        is_error, error_payload = _check_error_result(result)

        if (
            tool_name in ("finish_scan", "agent_finish")
            and not is_error
            and isinstance(result, dict)
        ):
            if tool_name == "finish_scan":
                should_agent_finish = result.get("scan_completed", False)
            elif tool_name == "agent_finish":
                should_agent_finish = result.get("agent_completed", False)

        _update_tracer_with_result(tracer, execution_id, is_error, result, error_payload)

    except (ConnectionError, RuntimeError, ValueError, TypeError, OSError) as e:
        error_msg = str(e)
        if tracer and execution_id:
            tracer.update_tool_execution(execution_id, "error", error_msg)
        raise

    observation_xml, images = _format_tool_result(tool_name, result)
    return observation_xml, images, should_agent_finish


def _get_tracer_and_agent_id(agent_state: Any | None) -> tuple[Any | None, str]:
    try:
        from strix.telemetry.tracer import get_global_tracer

        tracer = get_global_tracer()
        agent_id = agent_state.agent_id if agent_state else "unknown_agent"
    except (ImportError, AttributeError):
        tracer = None
        agent_id = "unknown_agent"

    return tracer, agent_id


async def process_tool_invocations(
    tool_invocations: list[dict[str, Any]],
    conversation_history: list[dict[str, Any]],
    agent_state: Any | None = None,
) -> bool:
    observation_parts: list[str] = []
    all_images: list[dict[str, Any]] = []
    should_agent_finish = False

    tracer, agent_id = _get_tracer_and_agent_id(agent_state)

    for tool_inv in tool_invocations:
        observation_xml, images, tool_should_finish = await _execute_single_tool(
            tool_inv, agent_state, tracer, agent_id
        )
        observation_parts.append(observation_xml)
        all_images.extend(images)

        if tool_should_finish:
            should_agent_finish = True

    if all_images:
        content = [{"type": "text", "text": "Tool Results:\n\n" + "\n\n".join(observation_parts)}]
        content.extend(all_images)
        conversation_history.append({"role": "user", "content": content})
    else:
        observation_content = "Tool Results:\n\n" + "\n\n".join(observation_parts)
        conversation_history.append({"role": "user", "content": observation_content})

    return should_agent_finish


def extract_screenshot_from_result(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None

    screenshot = result.get("screenshot")
    if isinstance(screenshot, str) and screenshot:
        return screenshot

    return None


def remove_screenshot_from_result(result: Any) -> Any:
    if not isinstance(result, dict):
        return result

    result_copy = result.copy()
    if "screenshot" in result_copy:
        result_copy["screenshot"] = "[Image data extracted - see attached image]"

    return result_copy


def _extract_image_base64_from_result(result: Any) -> tuple[str | None, str | None]:
    """Pull a ``(image_base64, mime_type)`` pair from a tool result, if present.

    This is the multimodal channel used by tools like ``view_image`` that need
    to return arbitrary image formats (not just screenshot PNGs).
    """
    if not isinstance(result, dict):
        return None, None
    data = result.get("image_base64")
    mime = result.get("mime_type")
    if isinstance(data, str) and data and isinstance(mime, str) and mime.startswith("image/"):
        return data, mime
    return None, None


def _remove_image_base64_from_result(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    result_copy = result.copy()
    if "image_base64" in result_copy:
        result_copy["image_base64"] = "[Image data extracted - see attached image]"
    return result_copy
