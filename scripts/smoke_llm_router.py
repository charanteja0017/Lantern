"""Smoke test for the LLM role router core."""

from __future__ import annotations

import importlib.util
import os
import sys
import types
from pathlib import Path


def _stub_package(name: str) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    mod = types.ModuleType(name)
    mod.__path__ = []
    sys.modules[name] = mod
    return mod


def _load(fqn: str, rel_path: str):
    mod_path = Path(__file__).resolve().parent.parent / rel_path
    spec = importlib.util.spec_from_file_location(fqn, mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[fqn] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    for pkg in ("strix", "strix.llm"):
        _stub_package(pkg)
    router_mod = _load("strix.llm.router", "strix/llm/router.py")

    os.environ["STRIX_LLM"] = "openai/gpt-4.1"
    os.environ["LLM_API_KEY"] = "sk-env-default"
    os.environ.pop("LLM_API_BASE", None)

    router_mod.reset_router()
    router = router_mod.get_router()

    # 1) With no configured routes, env fallback is used for every role.
    default = router.resolve("default")
    assert default.model == "openai/gpt-4.1"
    assert default.api_key == "sk-env-default"
    executor = router.resolve("executor")
    assert executor.model == "openai/gpt-4.1", executor.model
    assert executor.api_key == "sk-env-default"

    # 2) Global "default" spec wins over env and is inherited by unset roles.
    router.set_global(
        router_mod.RouteSpec(
            role="default",
            model="anthropic/claude-4.6-sonnet",
            api_key="sk-anthropic-global",
        )
    )
    default2 = router.resolve("default")
    assert default2.model == "anthropic/claude-4.6-sonnet", default2.model
    assert router.resolve("planner").model == "anthropic/claude-4.6-sonnet"
    assert router.resolve("vision").model == "anthropic/claude-4.6-sonnet"

    # 3) Per-role global override wins over default.
    router.set_global(
        router_mod.RouteSpec(
            role="executor",
            model="openai/gpt-4.1-mini",
            api_key="sk-openai-exec",
            max_tokens=4096,
        )
    )
    exec_route = router.resolve("executor")
    assert exec_route.model == "openai/gpt-4.1-mini"
    assert exec_route.max_tokens == 4096
    assert exec_route.api_key == "sk-openai-exec"
    # Other roles remain on the default route.
    assert router.resolve("reporter").model == "anthropic/claude-4.6-sonnet"

    # 4) Per-run override wins over global.
    router.set_run(
        "run-42",
        router_mod.RouteSpec(role="reporter", model="anthropic/claude-opus-4"),
    )
    reporter_run = router.resolve("reporter", run_id="run-42")
    assert reporter_run.model == "anthropic/claude-opus-4"
    # Without the run_id, the global fallback still applies.
    assert router.resolve("reporter").model == "anthropic/claude-4.6-sonnet"

    # 5) Ambient scope (set_ambient_scope) is picked up implicitly.
    router.set_ambient_scope(run_id="run-42")
    reporter_ambient = router.resolve("reporter")
    assert reporter_ambient.model == "anthropic/claude-opus-4"
    router.set_ambient_scope()

    # 6) Org scope sits between run and global.
    router.set_org(
        "org-acme",
        router_mod.RouteSpec(role="reasoner", model="openai/o1-preview"),
    )
    reasoner_org = router.resolve("reasoner", org_id="org-acme")
    assert reasoner_org.model == "openai/o1-preview"
    # Per-run override still wins.
    router.set_run(
        "run-99",
        router_mod.RouteSpec(role="reasoner", model="google/gemini-2.5-pro"),
    )
    assert (
        router.resolve("reasoner", run_id="run-99", org_id="org-acme").model
        == "google/gemini-2.5-pro"
    )

    # 7) prepare_completion_args applies model + api_key + metadata correctly.
    args = router.prepare_completion_args(
        "executor",
        {"messages": [{"role": "user", "content": "hi"}], "timeout": 120},
    )
    assert args["model"] == "openai/gpt-4.1-mini"
    assert args["api_key"] == "sk-openai-exec"
    assert args["max_tokens"] == 4096
    assert args["metadata"]["novahunter_role"] == "executor"
    assert args["metadata"]["novahunter_model"] == "openai/gpt-4.1-mini"
    # Caller-provided metadata is preserved.
    args2 = router.prepare_completion_args(
        "reporter",
        {
            "messages": [],
            "metadata": {"trace_id": "abc"},
        },
        run_id="run-42",
    )
    assert args2["model"] == "anthropic/claude-opus-4"
    assert args2["metadata"]["trace_id"] == "abc"
    assert args2["metadata"]["novahunter_role"] == "reporter"

    # 8) clear_run drops the run-scope override.
    router.clear_run("run-42")
    assert router.resolve("reporter", run_id="run-42").model == "anthropic/claude-4.6-sonnet"

    # 9) Disabled route falls back to default.
    router.set_global(
        router_mod.RouteSpec(
            role="vision", model="openai/gpt-4o", enabled=False, api_key="sk-x"
        )
    )
    assert router.resolve("vision").model == "anthropic/claude-4.6-sonnet"

    # 10) Role-specific env var beats generic STRIX_LLM when no DB route.
    router_mod.reset_router()
    os.environ["STRIX_LLM_VISION"] = "openai/gpt-4o-vision"
    router2 = router_mod.get_router()
    assert router2.resolve("vision").model == "openai/gpt-4o-vision"
    del os.environ["STRIX_LLM_VISION"]

    print("OK: ModelRouter core passes all 10 cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
