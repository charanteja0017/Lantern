"""Pluggable LLM provider catalog.

The router sends requests via LiteLLM, which already speaks every common
provider's wire format. This package exists so the UI + operators can
discover available providers, know which env var holds the API key, and
get sane default model suggestions without having to memorize LiteLLM's
naming conventions.

Each provider is a small :class:`ProviderSpec` describing:

* ``id`` - stable identifier used by the DB (``openai``, ``anthropic``...).
* ``display_name`` - human label in the admin UI.
* ``litellm_prefix`` - what LiteLLM expects in front of a model id
  (``openai/``, ``anthropic/``, ``gemini/``, ``mistral/``, ``ollama/``).
* ``env_key`` - primary env var the operator is expected to set when not
  using the encrypted secret store.
* ``default_api_base`` - optional override; usually ``None`` so LiteLLM
  uses the provider's public endpoint.
* ``suggested_models`` - seed list of model ids to surface in dropdowns.
* ``supports`` - capability flags consumed by the UI to filter roles
  (e.g. ``vision=True`` for a route assigned to the ``vision`` role).

``custom`` is an escape hatch: operators can register any LiteLLM-compatible
model by prefix (``openrouter/...``, ``together_ai/...``, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProviderCaps:
    chat: bool = True
    tools: bool = True
    vision: bool = False
    reasoning: bool = False
    streaming: bool = True


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    display_name: str
    litellm_prefix: str
    env_key: str
    default_api_base: str | None = None
    suggested_models: tuple[str, ...] = ()
    docs_url: str | None = None
    supports: ProviderCaps = field(default_factory=ProviderCaps)

    def model_id(self, short_name: str) -> str:
        """Return a fully-qualified LiteLLM model id.

        ``short_name`` may already be prefixed; if so we leave it alone.
        """
        if "/" in short_name:
            return short_name
        return f"{self.litellm_prefix.rstrip('/')}/{short_name}"


OPENAI = ProviderSpec(
    id="openai",
    display_name="OpenAI",
    litellm_prefix="openai",
    env_key="OPENAI_API_KEY",
    docs_url="https://platform.openai.com/docs/models",
    suggested_models=(
        "openai/gpt-4.1",
        "openai/gpt-4.1-mini",
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "openai/o4-mini",
    ),
    supports=ProviderCaps(vision=True, reasoning=True),
)


ANTHROPIC = ProviderSpec(
    id="anthropic",
    display_name="Anthropic (Claude)",
    litellm_prefix="anthropic",
    env_key="ANTHROPIC_API_KEY",
    docs_url="https://docs.anthropic.com/en/docs/about-claude/models",
    suggested_models=(
        "anthropic/claude-3-5-sonnet-latest",
        "anthropic/claude-3-5-haiku-latest",
        "anthropic/claude-3-opus-latest",
    ),
    supports=ProviderCaps(vision=True, reasoning=True),
)


GOOGLE = ProviderSpec(
    id="google",
    display_name="Google Gemini",
    litellm_prefix="gemini",
    env_key="GEMINI_API_KEY",
    docs_url="https://ai.google.dev/gemini-api/docs/models",
    suggested_models=(
        "gemini/gemini-2.0-pro",
        "gemini/gemini-2.0-flash",
        "gemini/gemini-2.5-pro",
    ),
    supports=ProviderCaps(vision=True, reasoning=True),
)


MISTRAL = ProviderSpec(
    id="mistral",
    display_name="Mistral",
    litellm_prefix="mistral",
    env_key="MISTRAL_API_KEY",
    docs_url="https://docs.mistral.ai/getting-started/models/models_overview/",
    suggested_models=(
        "mistral/mistral-large-latest",
        "mistral/mistral-small-latest",
        "mistral/codestral-latest",
    ),
)


GROQ = ProviderSpec(
    id="groq",
    display_name="Groq",
    litellm_prefix="groq",
    env_key="GROQ_API_KEY",
    docs_url="https://console.groq.com/docs/models",
    suggested_models=(
        "groq/llama-3.3-70b-versatile",
        "groq/llama-3.1-8b-instant",
    ),
)


DEEPSEEK = ProviderSpec(
    id="deepseek",
    display_name="DeepSeek (official API)",
    litellm_prefix="deepseek",
    env_key="DEEPSEEK_API_KEY",
    default_api_base=None,
    docs_url="https://api-docs.deepseek.com/",
    suggested_models=(
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-chat",
        "deepseek/deepseek-reasoner",
        "deepseek/deepseek-coder",
    ),
    supports=ProviderCaps(reasoning=True, tools=True),
)


OLLAMA = ProviderSpec(
    id="ollama",
    display_name="Ollama (local)",
    litellm_prefix="ollama_chat",
    env_key="OLLAMA_API_KEY",  # usually unused; kept for parity
    default_api_base="http://host.docker.internal:11434",
    docs_url="https://docs.litellm.ai/docs/providers/ollama",
    suggested_models=(
        "ollama_chat/llama3.1",
        "ollama_chat/qwen2.5-coder",
        "ollama_chat/deepseek-r1",
    ),
    supports=ProviderCaps(streaming=True, tools=False),
)


OPENROUTER = ProviderSpec(
    id="openrouter",
    display_name="OpenRouter",
    litellm_prefix="openrouter",
    env_key="OPENROUTER_API_KEY",
    default_api_base="https://openrouter.ai/api/v1",
    docs_url="https://openrouter.ai/models",
    suggested_models=(
        "openrouter/meta-llama/llama-3.1-70b-instruct",
        "openrouter/anthropic/claude-3-haiku",
    ),
)


CUSTOM = ProviderSpec(
    id="custom",
    display_name="Custom (any LiteLLM-compatible endpoint)",
    litellm_prefix="",
    env_key="LLM_API_KEY",
    docs_url="https://docs.litellm.ai/docs/providers",
)


PROVIDERS: tuple[ProviderSpec, ...] = (
    OPENAI,
    ANTHROPIC,
    GOOGLE,
    MISTRAL,
    GROQ,
    DEEPSEEK,
    OLLAMA,
    OPENROUTER,
    CUSTOM,
)


def get_provider(provider_id: str) -> ProviderSpec | None:
    for spec in PROVIDERS:
        if spec.id == provider_id:
            return spec
    return None


def identify_provider(model_id: str) -> ProviderSpec | None:
    """Guess the provider for a LiteLLM model id (``openai/gpt-4.1-mini``)."""
    if not model_id:
        return None
    prefix = model_id.split("/", 1)[0].lower()
    for spec in PROVIDERS:
        if spec.litellm_prefix and spec.litellm_prefix.lower() == prefix:
            return spec
    return CUSTOM


def has_known_provider_prefix(model_id: str) -> bool:
    """Return True when ``model_id`` already carries a known LiteLLM prefix."""
    if not model_id or "/" not in model_id:
        return False
    prefix = model_id.split("/", 1)[0].strip().lower()
    if not prefix:
        return False
    return any(
        spec.litellm_prefix and spec.litellm_prefix.strip().lower() == prefix for spec in PROVIDERS
    )


def normalize_model_for_endpoint(model_id: str, api_base: str | None) -> str:
    """Best-effort model normalization for provider-specific endpoints.

    NVIDIA NIM's OpenAI-compatible endpoint expects an OpenAI-family provider
    prefix in LiteLLM. Users commonly paste models like ``mistralai/...``; for
    those we rewrite to ``openai/mistralai/...`` so LiteLLM can route the call.
    """
    model = (model_id or "").strip()
    if not model:
        return model
    if has_known_provider_prefix(model):
        return model
    if "/" not in model:
        return model
    base = (api_base or "").lower()
    if "integrate.api.nvidia.com" in base:
        return f"openai/{model}"
    return model


def as_public_dict(spec: ProviderSpec) -> dict[str, object]:
    return {
        "id": spec.id,
        "display_name": spec.display_name,
        "litellm_prefix": spec.litellm_prefix,
        "env_key": spec.env_key,
        "default_api_base": spec.default_api_base,
        "suggested_models": list(spec.suggested_models),
        "docs_url": spec.docs_url,
        "supports": {
            "chat": spec.supports.chat,
            "tools": spec.supports.tools,
            "vision": spec.supports.vision,
            "reasoning": spec.supports.reasoning,
            "streaming": spec.supports.streaming,
        },
    }


__all__ = [
    "ANTHROPIC",
    "CUSTOM",
    "DEEPSEEK",
    "GOOGLE",
    "GROQ",
    "MISTRAL",
    "OLLAMA",
    "OPENAI",
    "OPENROUTER",
    "PROVIDERS",
    "ProviderCaps",
    "ProviderSpec",
    "as_public_dict",
    "get_provider",
    "has_known_provider_prefix",
    "identify_provider",
    "normalize_model_for_endpoint",
]
