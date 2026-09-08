"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { config } from "@/lib/config";
import { getProvider } from "@/lib/api";
import type {
  LlmConfigRead,
  LlmConfigWrite,
  LlmTestResult,
  OrgSummary,
} from "@/lib/types";

type ProviderKind =
  | "anthropic/claude-sonnet"
  | "anthropic/claude-opus"
  | "openai/gpt-5.4"
  | "openai/gpt-5.3-codex"
  | "deepseek/api"
  | "nvidia/nim"
  | "nvidia/nim-auto"
  | "ollama/local"
  | "ollama/cloud"
  | "auto"
  | "custom";

type ProviderPreset = {
  label: string;
  model: string;
  baseUrl: string;
  needsKey: boolean;
  helper: string;
};

const DEFAULTS: Record<ProviderKind, ProviderPreset> = {
  "anthropic/claude-sonnet": {
    label: "Anthropic · Claude Sonnet",
    model: "anthropic/claude-sonnet-4",
    baseUrl: "",
    needsKey: true,
    helper: "Uses the official Anthropic API.",
  },
  "anthropic/claude-opus": {
    label: "Anthropic · Claude Opus",
    model: "anthropic/claude-opus-4",
    baseUrl: "",
    needsKey: true,
    helper: "Uses the official Anthropic API.",
  },
  "openai/gpt-5.4": {
    label: "OpenAI · GPT-5.4",
    model: "openai/gpt-5.4",
    baseUrl: "",
    needsKey: true,
    helper: "Uses the official OpenAI API.",
  },
  "openai/gpt-5.3-codex": {
    label: "OpenAI · GPT-5.3 Codex",
    model: "openai/gpt-5.3-codex",
    baseUrl: "",
    needsKey: true,
    helper: "Uses the official OpenAI API.",
  },
  "deepseek/api": {
    label: "DeepSeek · official API",
    model: "deepseek/deepseek-v4-flash",
    baseUrl: "",
    needsKey: true,
    helper:
      "OpenAI-compatible API at api.deepseek.com. Create a key at platform.deepseek.com. LiteLLM uses the deepseek/ model prefix — pick a model below.",
  },
  "nvidia/nim": {
    label: "NVIDIA · NIM (hosted)",
    model: "openai/deepseek-ai/deepseek-r1",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    helper:
      "NVIDIA NIM hosted models via an OpenAI-compatible endpoint. Free tier is commonly 40 RPM; you can configure Free/Paid and an RPM cap below.",
  },
  "nvidia/nim-auto": {
    label: "NVIDIA · NIM (auto / dynamic switching)",
    model: "auto",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    helper:
      "Same as global Auto: pick a model per request from your pool and fall back on errors or low-quality output — constrained to the NVIDIA NIM endpoint and your RPM settings below.",
  },
  "ollama/local": {
    label: "Ollama · Self-hosted (local or VPS)",
    model: "ollama/llama3.1:70b",
    baseUrl: "http://localhost:11434",
    needsKey: false,
    helper:
      "Point this at any reachable Ollama server — localhost, a VPS public IP, or a private network address.",
  },
  "ollama/cloud": {
    label: "Ollama · Cloud",
    model: "ollama/gpt-oss:120b-cloud",
    baseUrl: "https://ollama.com",
    needsKey: true,
    helper:
      "Uses Ollama's hosted cloud. Requires an Ollama API key. Some models are free-tier; others need Pro/Max at https://ollama.com/upgrade.",
  },
  auto: {
    label: "Auto (dynamic model switching)",
    model: "auto",
    baseUrl: "",
    needsKey: false,
    helper:
      "Automatically pick a model per request from a pool (across providers), and fall back if output quality is low or errors occur.",
  },
  custom: {
    label: "Custom (OpenAI-compatible endpoint)",
    model: "openai/your-model",
    baseUrl: "https://api.your-provider.com/v1",
    needsKey: true,
    helper:
      "Any OpenAI-compatible endpoint — vLLM, LM Studio, LiteLLM proxy, OpenRouter, Together, Fireworks, Groq, etc.",
  },
};

/** LiteLLM ids for DeepSeek's official API — see https://api-docs.deepseek.com/ */
const DEEPSEEK_LITELLM_MODELS: { value: string; label: string }[] = [
  {
    value: "deepseek/deepseek-v4-flash",
    label: "deepseek-v4-flash — V4 Flash (default, high volume)",
  },
  {
    value: "deepseek/deepseek-v4-pro",
    label: "deepseek-v4-pro — V4 Pro (frontier)",
  },
  {
    value: "deepseek/deepseek-chat",
    label: "deepseek-chat — legacy alias (→ V4 Flash non-thinking; deprecated 2026-07-24)",
  },
  {
    value: "deepseek/deepseek-reasoner",
    label: "deepseek-reasoner — legacy alias (→ V4 Flash thinking; deprecated 2026-07-24)",
  },
  {
    value: "deepseek/deepseek-coder",
    label: "deepseek-coder — code (LiteLLM; confirm in GET /models if needed)",
  },
];

const DEEPSEEK_CATALOG_IDS = new Set(DEEPSEEK_LITELLM_MODELS.map((m) => m.value));

// ``LEAVE_UNCHANGED`` means "the user did not edit the secret field", which
// we encode as ``null`` in the PUT payload so the server keeps its copy.
// Empty string clears. Anything else overwrites.
const LEAVE_UNCHANGED = Symbol("leave-unchanged");
type SecretValue = string | typeof LEAVE_UNCHANGED;

function providerForModel(model: string, apiBase: string): ProviderKind {
  if (model.startsWith("anthropic/") && model.includes("opus")) return "anthropic/claude-opus";
  if (model.startsWith("anthropic/")) return "anthropic/claude-sonnet";
  if (model.startsWith("deepseek/")) return "deepseek/api";
  if (model.startsWith("openai/") && model.includes("codex")) return "openai/gpt-5.3-codex";
  if (model.startsWith("openai/")) return "openai/gpt-5.4";
  if (model === "auto") {
    const b = (apiBase || "").toLowerCase();
    if (b.includes("integrate.api.nvidia.com")) return "nvidia/nim-auto";
    return "auto";
  }
  if (model.startsWith("ollama/")) return "ollama/cloud";
  return "custom";
}

export default function SettingsPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [serverCfg, setServerCfg] = useState<LlmConfigRead | null>(null);
  const [provider, setProvider] = useState<ProviderKind>("anthropic/claude-sonnet");
  const [model, setModel] = useState<string>(DEFAULTS["anthropic/claude-sonnet"].model);
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [reasoningEffort, setReasoningEffort] = useState<string>("high");
  const [apiKey, setApiKey] = useState<SecretValue>(LEAVE_UNCHANGED);
  const [perplexityKey, setPerplexityKey] = useState<SecretValue>(LEAVE_UNCHANGED);
  const [nimPlan, setNimPlan] = useState<"free" | "paid">("free");
  const [nimRpmCap, setNimRpmCap] = useState<string>("40");
  const [autoPool, setAutoPool] = useState<string>("");
  const [autoStrategy, setAutoStrategy] = useState<"rules" | "hybrid">("hybrid");
  const [autoRouterModel, setAutoRouterModel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  const applyServerConfig = useCallback((cfg: LlmConfigRead) => {
    setServerCfg(cfg);
    let kind = (cfg.provider as ProviderKind) in DEFAULTS
      ? (cfg.provider as ProviderKind)
      : providerForModel(cfg.model, cfg.api_base);
    if (
      cfg.model === "auto" &&
      (cfg.api_base || "").toLowerCase().includes("integrate.api.nvidia.com") &&
      kind === "auto"
    ) {
      kind = "nvidia/nim-auto";
    }
    setProvider(kind);
    setModel(cfg.model || DEFAULTS[kind].model);
    setBaseUrl(cfg.api_base || "");
    setReasoningEffort(cfg.reasoning_effort || "high");
    setNimPlan(cfg.nim_plan === "paid" ? "paid" : "free");
    setNimRpmCap(String(cfg.nim_rpm_cap ?? 40));
    setAutoPool(cfg.auto_pool || "");
    setAutoStrategy(cfg.auto_strategy === "rules" ? "rules" : "hybrid");
    setAutoRouterModel(cfg.auto_router_model || "");
    // Never pre-fill secret fields — the server never returns them. An
    // unedited password input should leave the saved value alone.
    setApiKey(LEAVE_UNCHANGED);
    setPerplexityKey(LEAVE_UNCHANGED);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const provider = getProvider();
    (async () => {
      try {
        const cfg = await provider.getLlmConfig();
        if (!cancelled) applyServerConfig(cfg);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            `Failed to load saved LLM config: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        const list = await provider.listOrganizations();
        if (!cancelled) setOrgs(list);
      } catch {
        if (!cancelled) setOrgs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyServerConfig]);

  const preset = useMemo(() => DEFAULTS[provider], [provider]);
  const isSelfHosted = provider === "ollama/local";
  const isCustom = provider === "custom";
  const isOllamaCloud = provider === "ollama/cloud";
  const isOllama = isSelfHosted || isOllamaCloud;
  const isDeepSeek = provider === "deepseek/api";
  const isNimAuto = provider === "nvidia/nim-auto";
  const usesNimPlan = provider === "nvidia/nim" || isNimAuto;
  const isAuto = provider === "auto";
  const usesAutoPool = isAuto || isNimAuto;
  const showBaseUrl = isSelfHosted || isCustom || isOllamaCloud || isDeepSeek;
  const showApiKey = preset.needsKey;

  const onProviderChange = (next: string) => {
    const k = next as ProviderKind;
    setProvider(k);
    setModel(DEFAULTS[k].model);
    setBaseUrl(DEFAULTS[k].baseUrl);
    setApiKey(LEAVE_UNCHANGED);
    if (k === "nvidia/nim" || k === "nvidia/nim-auto") {
      setNimPlan("free");
      setNimRpmCap("40");
    }
    if (k === "auto" || k === "nvidia/nim-auto") {
      setAutoStrategy("hybrid");
    }
  };

  const buildPayload = useCallback((): LlmConfigWrite => {
    const parseRpm = (raw: string): number | null => {
      const t = raw.trim();
      if (!t) return null;
      const n = Number(t);
      if (!Number.isFinite(n)) return null;
      const i = Math.floor(n);
      return i > 0 ? i : null;
    };
    return {
      provider,
      model: model.trim(),
      api_base: baseUrl.trim(),
      reasoning_effort: reasoningEffort,
      api_key: apiKey === LEAVE_UNCHANGED ? null : apiKey,
      perplexity_key: perplexityKey === LEAVE_UNCHANGED ? null : perplexityKey,
      nim_plan: usesNimPlan ? nimPlan : undefined,
      nim_rpm_cap: usesNimPlan ? parseRpm(nimRpmCap) : undefined,
      auto_pool: usesAutoPool ? autoPool : undefined,
      auto_strategy: usesAutoPool ? autoStrategy : undefined,
      auto_router_model: usesAutoPool ? autoRouterModel.trim() : undefined,
    };
  }, [
    provider,
    model,
    baseUrl,
    reasoningEffort,
    apiKey,
    perplexityKey,
    usesNimPlan,
    nimPlan,
    nimRpmCap,
    usesAutoPool,
    autoPool,
    autoStrategy,
    autoRouterModel,
  ]);

  const validate = useCallback((): string | null => {
    if (!model.trim()) return "Model identifier is required.";
    if (showBaseUrl && !baseUrl.trim())
      return "Base URL is required for this provider.";
    if (usesNimPlan) {
      const n = Number(nimRpmCap.trim() || "0");
      if (!Number.isFinite(n) || n <= 0) return "NIM RPM cap must be a positive number.";
    }
    if (usesAutoPool && !autoPool.trim()) {
      return "Auto pool is required (comma-separated list of models).";
    }
    if (
      showApiKey &&
      !serverCfg?.api_key_set &&
      apiKey === LEAVE_UNCHANGED &&
      !isCustom
    )
      return "API key is required for this provider.";
    return null;
  }, [
    model,
    baseUrl,
    showBaseUrl,
    showApiKey,
    apiKey,
    serverCfg,
    isCustom,
    usesNimPlan,
    nimRpmCap,
    usesAutoPool,
    autoPool,
  ]);

  const onSave = useCallback(async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const saved = await getProvider().saveLlmConfig(buildPayload());
      applyServerConfig(saved);
      toast.success("LLM provider settings saved to the server.");
      setTestResult(null);
    } catch (e) {
      toast.error(
        `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSaving(false);
    }
  }, [validate, buildPayload, applyServerConfig]);

  const onTest = useCallback(async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await getProvider().testLlmConfig(buildPayload());
      setTestResult(res);
      if (res.ok) {
        toast.success(
          `Connection OK · ${res.model} · ${Math.round(res.latency_ms)}ms`,
        );
      } else {
        toast.error("Model did not respond — see error details below.");
      }
    } catch (e) {
      toast.error(
        `Test failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setTesting(false);
    }
  }, [validate, buildPayload]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace, provider, runtime, and safety configuration."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/llm">Open advanced LLM settings</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/mcp">Open MCP settings</Link>
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
            <CardDescription>Runtime configuration for this deployment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="App name" value={config.appName} />
            <Field
              label="Mode"
              value={config.demo ? "Demo" : "Live"}
              badge={config.demo ? "warning" : "success"}
            />
            <Field label="API base URL" value={config.apiBaseUrl || "—"} mono />
            <Field
              label="Clerk"
              value={config.clerk.publishableKey ? "configured" : "not configured"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LLM provider</CardTitle>
            <CardDescription>
              Pick a hosted model, an Ollama endpoint, or any OpenAI-compatible
              server. Settings are stored on the server so scans actually use
              them — always click <strong>Test connection</strong> after saving
              to verify.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved
                configuration…
              </div>
            ) : serverCfg ? (
              <div className="rounded-md border border-border bg-surface/60 p-3 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Currently persisted on the server</span>
                  <Badge variant={serverCfg.api_key_set ? "success" : "warning"}>
                    {serverCfg.api_key_set ? "key on file" : "no key"}
                  </Badge>
                </div>
                <div className="mt-1">
                  <span className="font-mono text-[11px]">
                    {serverCfg.model || "—"}
                  </span>
                  {serverCfg.api_base ? (
                    <span className="ml-2 font-mono text-[11px] opacity-70">
                      @ {serverCfg.api_base}
                    </span>
                  ) : null}
                  {serverCfg.api_key_set ? (
                    <span className="ml-2 font-mono text-[11px] opacity-70">
                      key: {serverCfg.api_key_preview}
                    </span>
                  ) : null}
                </div>
                {serverCfg.updated_by ? (
                  <div className="mt-1 opacity-70">
                    Last updated by {serverCfg.updated_by}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Default model
              </label>
              <Select value={provider} onValueChange={onProviderChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic/claude-sonnet">
                    Anthropic · Claude Sonnet
                  </SelectItem>
                  <SelectItem value="anthropic/claude-opus">
                    Anthropic · Claude Opus
                  </SelectItem>
                  <SelectItem value="openai/gpt-5.4">OpenAI · GPT-5.4</SelectItem>
                  <SelectItem value="openai/gpt-5.3-codex">
                    OpenAI · GPT-5.3 Codex
                  </SelectItem>
                  <SelectItem value="deepseek/api">DeepSeek · official API</SelectItem>
                <SelectItem value="nvidia/nim">NVIDIA · NIM</SelectItem>
                  <SelectItem value="nvidia/nim-auto">
                    NVIDIA · NIM (auto / dynamic switching)
                  </SelectItem>
                  <SelectItem value="ollama/local">
                    Ollama · Self-hosted (local or VPS)
                  </SelectItem>
                  <SelectItem value="ollama/cloud">Ollama · Cloud</SelectItem>
                <SelectItem value="auto">Auto (dynamic switching)</SelectItem>
                  <SelectItem value="custom">
                    Custom (OpenAI-compatible)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">{preset.helper}</p>
            </div>

          {usesNimPlan && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  NIM plan
                </label>
                <Select value={nimPlan} onValueChange={(v) => setNimPlan(v as "free" | "paid")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">free (default 40 RPM)</SelectItem>
                    <SelectItem value="paid">paid (custom RPM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  NIM RPM cap
                </label>
                <Input
                  value={nimRpmCap}
                  onChange={(e) => setNimRpmCap(e.target.value)}
                  placeholder={nimPlan === "free" ? "40" : "e.g. 200"}
                  spellCheck={false}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This cap is enforced by NovaHunter at runtime to avoid quota errors.
                </p>
              </div>
            </div>
          )}

          {usesAutoPool && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Auto pool (comma-separated models)
                </label>
                <Input
                  value={autoPool}
                  onChange={(e) => setAutoPool(e.target.value)}
                  placeholder={
                    isNimAuto
                      ? "openai/nvidia/llama-3.1-nemotron-ultra-253b-v1,openai/deepseek-ai/deepseek-r1"
                      : "openai/gpt-4.1-mini,anthropic/claude-3-5-haiku-latest,openai/deepseek-ai/deepseek-r1"
                  }
                  spellCheck={false}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Auto strategy
                  </label>
                  <Select
                    value={autoStrategy}
                    onValueChange={(v) => setAutoStrategy(v as "rules" | "hybrid")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rules">rules</SelectItem>
                      <SelectItem value="hybrid">hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Router model (optional)
                  </label>
                  <Input
                    value={autoRouterModel}
                    onChange={(e) => setAutoRouterModel(e.target.value)}
                    placeholder="e.g. openai/gpt-4.1-mini"
                    spellCheck={false}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {isNimAuto
                  ? "Models must be NIM-hosted LiteLLM ids (typically openai/…). Requests use the NIM base URL and your RPM cap above."
                  : "The router will pick a model from the pool and fall back when output quality is low or when a provider throttles."}
              </p>
            </div>
          )}

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Model identifier
              </label>
              {isDeepSeek ? (
                <>
                  <Select
                    value={DEEPSEEK_CATALOG_IDS.has(model) ? model : "__other__"}
                    onValueChange={(v) => {
                      if (v === "__other__") {
                        setModel((prev) => (DEEPSEEK_CATALOG_IDS.has(prev) ? "deepseek/" : prev));
                        return;
                      }
                      setModel(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEEPSEEK_LITELLM_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="__other__">Other (custom LiteLLM id)…</SelectItem>
                    </SelectContent>
                  </Select>
                  {!DEEPSEEK_CATALOG_IDS.has(model) && (
                    <Input
                      className="mt-2"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="deepseek/deepseek-v4-pro"
                      spellCheck={false}
                    />
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Matches DeepSeek's documented model names (V4 Flash/Pro plus legacy aliases). See{" "}
                    <a
                      className="underline"
                      href="https://api-docs.deepseek.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      DeepSeek API docs
                    </a>{" "}
                    and{" "}
                    <a
                      className="underline"
                      href="https://api-docs.deepseek.com/quick_start/pricing"
                      target="_blank"
                      rel="noreferrer"
                    >
                      models and pricing
                    </a>
                    . LiteLLM expects the{" "}
                    <code className="font-mono">deepseek/</code> prefix (
                    <a
                      className="underline"
                      href="https://docs.litellm.ai/docs/providers/deepseek"
                      target="_blank"
                      rel="noreferrer"
                    >
                      LiteLLM DeepSeek
                    </a>
                    ).
                  </p>
                </>
              ) : (
                <>
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={preset.model}
                    spellCheck={false}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    LiteLLM-style id.{" "}
                    {isOllama ? (
                      <>
                        For Ollama Cloud try{" "}
                        <code className="font-mono">ollama/gpt-oss:120b-cloud</code>{" "}
                        or <code className="font-mono">ollama/qwen3:235b-cloud</code>;
                        for self-hosted e.g.{" "}
                        <code className="font-mono">ollama/llama3.1:70b</code>.
                      </>
                    ) : isNimAuto ? (
                      <>
                        Use <code className="font-mono">auto</code>. The pool above lists which NIM
                        models to rotate through (e.g.{" "}
                        <code className="font-mono">openai/deepseek-ai/deepseek-r1</code>).
                      </>
                    ) : (
                      <>
                        Examples:{" "}
                        <code className="font-mono">anthropic/claude-sonnet-4</code>,{" "}
                        <code className="font-mono">openai/gpt-5.4</code>.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>

            {showBaseUrl && (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {isSelfHosted
                    ? "Ollama server URL"
                    : isOllamaCloud
                      ? "Ollama Cloud URL"
                      : isDeepSeek
                        ? "API base URL (optional)"
                        : "API base URL"}
                </label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={preset.baseUrl}
                  spellCheck={false}
                />
                {isSelfHosted && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Default Ollama port is <code className="font-mono">11434</code>.
                    Example: <code className="font-mono">http://203.0.113.10:11434</code>.
                    Make sure the port is reachable from the API container and{" "}
                    <code className="font-mono">OLLAMA_HOST=0.0.0.0</code> is set on
                    the Ollama host.
                  </p>
                )}
                {isOllamaCloud && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Use <code className="font-mono">https://ollama.com</code> unless
                    Ollama has given you a different endpoint.
                  </p>
                )}
                {isDeepSeek && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Leave blank to use LiteLLM's default{" "}
                    <code className="font-mono">https://api.deepseek.com</code> (OpenAI format per{" "}
                    <a
                      className="underline"
                      href="https://api-docs.deepseek.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      DeepSeek
                    </a>
                    ). Set only if you use a proxy or nonstandard host.
                  </p>
                )}
              </div>
            )}

            {showApiKey && (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  API key
                  {isCustom && <span className="opacity-60"> (optional)</span>}
                  {serverCfg?.api_key_set ? (
                    <span className="ml-2 rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-300">
                      on file · {serverCfg.api_key_preview}
                    </span>
                  ) : null}
                </label>
                <Input
                  type="password"
                  value={apiKey === LEAVE_UNCHANGED ? "" : apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    serverCfg?.api_key_set
                      ? "Leave blank to keep existing key"
                      : isOllamaCloud
                        ? "ollama api key"
                        : isCustom
                          ? "sk-… or leave blank"
                          : "sk-…"
                  }
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stored on the server in{" "}
                  <code className="font-mono">/data/strix_runs/.config/llm.json</code>{" "}
                  (mode 0600). Never exposed to the browser after save.
                </p>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Reasoning effort
              </label>
              <Select value={reasoningEffort} onValueChange={setReasoningEffort}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Applies to reasoning-capable models; ignored by the rest.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Perplexity key (optional)
                {serverCfg?.perplexity_key_set ? (
                  <span className="ml-2 rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-300">
                    on file
                  </span>
                ) : null}
              </label>
              <Input
                type="password"
                value={perplexityKey === LEAVE_UNCHANGED ? "" : perplexityKey}
                onChange={(e) => setPerplexityKey(e.target.value)}
                placeholder={
                  serverCfg?.perplexity_key_set
                    ? "Leave blank to keep existing key"
                    : "pplx-…"
                }
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="flex-1"
                onClick={onSave}
                disabled={saving || testing}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {saving ? "Saving…" : "Save provider settings"}
              </Button>
              <Button
                variant="outline"
                onClick={onTest}
                disabled={saving || testing}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Test connection
              </Button>
            </div>

            {testResult ? (
              <div
                className={`rounded-md border p-3 text-xs ${
                  testResult.ok
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
                    : "border-red-500/30 bg-red-500/5 text-red-100"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                  {testResult.ok ? "Connection successful" : "Connection failed"}
                  <span className="ml-auto font-mono text-[11px] opacity-70">
                    {testResult.model} · {Math.round(testResult.latency_ms)}ms
                  </span>
                </div>
                {testResult.ok && testResult.response_preview ? (
                  <div className="mt-2 whitespace-pre-wrap font-mono text-[11px] opacity-80">
                    model replied: {testResult.response_preview}
                  </div>
                ) : null}
                {testResult.error ? (
                  <div className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] opacity-90">
                    {linkify(testResult.error)}
                  </div>
                ) : null}
                {testResult.provider_hint ? (
                  <div className="mt-2 text-[11px] opacity-90">
                    <span className="font-medium">Hint:</span>{" "}
                    {linkify(testResult.provider_hint)}
                  </div>
                ) : null}
                {!testResult.ok && isOllamaCloud ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {[
                      "ollama/gpt-oss:20b-cloud",
                      "ollama/gpt-oss:120b-cloud",
                      "ollama/qwen3:32b-cloud",
                    ].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setModel(m)}
                        className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 font-mono text-red-50 hover:bg-red-400/20"
                      >
                        try {m}
                      </button>
                    ))}
                    <a
                      href="https://ollama.com/library?sort=newest&tag=cloud"
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-red-50 hover:bg-red-400/20"
                    >
                      browse cloud library ↗
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rate limit policy</CardTitle>
            <CardDescription>Bound LLM traffic to protect provider quotas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Anthropic TPM
                </label>
                <Input defaultValue={30000} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Anthropic RPM
                </label>
                <Input defaultValue={50} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">OpenAI TPM</label>
                <Input defaultValue={150000} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">OpenAI RPM</label>
                <Input defaultValue={500} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Ollama concurrency
                </label>
                <Input defaultValue={2} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Custom RPM
                </label>
                <Input defaultValue={120} />
              </div>
            </div>
            <Button variant="outline" className="w-full">
              Save limits
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organizations</CardTitle>
            <CardDescription>Workspaces you belong to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {orgs.length === 0 && (
              <p className="text-sm text-muted-foreground">No organizations loaded.</p>
            )}
            {orgs.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface/60 p-3"
              >
                <div>
                  <div className="text-sm font-medium">{o.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.memberCount} members · slug: {o.slug}
                  </div>
                </div>
                <Badge variant="outline">owner</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function linkify(text: string): ReactNode {
  // Split on URLs so we can render <a> for each match without trusting the
  // raw string (no dangerouslySetInnerHTML). Provider errors sometimes embed
  // upgrade / docs URLs we want to make clickable.
  const parts = text.split(/(https?:\/\/[^\s"')]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function Field({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: "success" | "warning";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant={badge}>{value}</Badge>
      ) : (
        <span className={mono ? "font-mono text-xs" : "text-sm"}>{value}</span>
      )}
    </div>
  );
}
