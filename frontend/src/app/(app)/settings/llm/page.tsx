"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  Download,
  ExternalLink,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/shell";
import { PageError, PageLoading } from "@/components/common/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProvider } from "@/lib/api";
import type { AuditEntry, LlmRole, LlmRouteEntry, LlmRouteWrite, LlmRoutesRead } from "@/lib/types";

type Draft = {
  model: string;
  api_base: string;
  api_key_ref: string;
  reasoning_effort: string;
  max_tokens: string;
  temperature: string;
  budget_usd: string;
  enabled: boolean;
};

const ROLE_HINTS: Record<LlmRole, string> = {
  default: "Global fallback route used when a role is unset/disabled.",
  planner: "High-level decomposition and campaign planning.",
  executor: "Hot path for tool-use loops; optimize for cost and latency.",
  reasoner: "Deep hypothesis and exploit reasoning path.",
  reporter: "Final report synthesis and write-up quality.",
  vision: "Image/screenshot analysis (must support multimodal input).",
  memory: "Context summarization/compression role.",
  dedupe: "Finding normalization and dedup checks.",
};

function toDraft(spec: LlmRouteEntry["spec"]): Draft {
  return {
    model: spec.model ?? "",
    api_base: spec.api_base ?? "",
    api_key_ref: "",
    reasoning_effort: spec.reasoning_effort ?? "",
    max_tokens: spec.max_tokens != null ? String(spec.max_tokens) : "",
    temperature: spec.temperature != null ? String(spec.temperature) : "",
    budget_usd: spec.budget_usd != null ? String(spec.budget_usd) : "",
    enabled: spec.enabled,
  };
}

function draftToWrite(role: LlmRole, draft: Draft): LlmRouteWrite | null {
  const model = draft.model.trim();
  if (!model) return null;
  const parseNum = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    role,
    model,
    api_base: draft.api_base.trim() || null,
    api_key_ref: draft.api_key_ref.trim() || null,
    reasoning_effort: draft.reasoning_effort.trim() || null,
    max_tokens: parseNum(draft.max_tokens),
    temperature: parseNum(draft.temperature),
    budget_usd: parseNum(draft.budget_usd),
    enabled: draft.enabled,
  };
}

export default function LlmSettingsPage() {
  const [routes, setRoutes] = useState<LlmRoutesRead | null>(null);
  const [drafts, setDrafts] = useState<Record<LlmRole, Draft>>({} as Record<LlmRole, Draft>);
  const [providers, setProviders] = useState<
    {
      id: string;
      display_name: string;
      litellm_prefix: string;
      env_key: string;
      default_api_base: string | null;
      suggested_models: string[];
      docs_url: string | null;
      supports: Record<string, boolean>;
    }[]
  >([]);
  const [secrets, setSecrets] = useState<{ name: string; preview: string }[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState<Set<LlmRole>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p, s, a] = await Promise.all([
        getProvider().listLlmRoutes(),
        getProvider().listLlmProviders(),
        getProvider().listSecrets(),
        getProvider().listAuditLog(),
      ]);
      setRoutes(r);
      setProviders(p.providers);
      setSecrets(s.secrets.map((x) => ({ name: x.name, preview: x.preview })));
      setAudit(a.filter((entry) => entry.action.includes("llm")).slice(0, 50));
      const next: Record<string, Draft> = {};
      for (const entry of r.roles) next[entry.role] = toDraft(entry.spec);
      setDrafts(next as Record<LlmRole, Draft>);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markSaving = (role: LlmRole, on: boolean) => {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(role);
      else next.delete(role);
      return next;
    });
  };

  const saveRole = async (role: LlmRole) => {
    const payload = draftToWrite(role, drafts[role]);
    if (!payload) {
      toast.error(`Model is required for ${role}`);
      return;
    }
    markSaving(role, true);
    try {
      const res = await getProvider().saveLlmRoutes({ routes: { [role]: payload } });
      setRoutes(res);
      const entry = res.roles.find((r) => r.role === role);
      if (entry) {
        setDrafts((prev) => ({ ...prev, [role]: toDraft(entry.spec) }));
      }
      toast.success(`Saved ${role}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      markSaving(role, false);
    }
  };

  const resetRole = async (role: LlmRole) => {
    markSaving(role, true);
    try {
      const res = await getProvider().deleteLlmRoute(role);
      setRoutes(res);
      const entry = res.roles.find((r) => r.role === role);
      if (entry) {
        setDrafts((prev) => ({ ...prev, [role]: toDraft(entry.spec) }));
      }
      toast.success(`Reset ${role}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      markSaving(role, false);
    }
  };

  const testRole = async (role: LlmRole) => {
    markSaving(role, true);
    try {
      const res = await getProvider().testLlmRoute(role);
      if (res.ok) {
        toast.success(`${role}: OK (${res.latency_ms ?? "?"}ms)`);
      } else {
        toast.error(res.error || `${role} test failed`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      markSaving(role, false);
    }
  };

  const exportJson = () => {
    if (!routes) return;
    const blob = new Blob([JSON.stringify(routes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `llm-routes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as { roles?: LlmRouteEntry[] };
      const routesMap: Record<string, LlmRouteWrite> = {};
      for (const row of raw.roles ?? []) {
        const spec = row.spec;
        routesMap[row.role] = {
          role: row.role,
          model: spec.model,
          api_base: spec.api_base ?? null,
          reasoning_effort: spec.reasoning_effort ?? null,
          max_tokens: spec.max_tokens ?? null,
          temperature: spec.temperature ?? null,
          budget_usd: spec.budget_usd ?? null,
          enabled: spec.enabled,
        };
      }
      const updated = await getProvider().saveLlmRoutes({ routes: routesMap });
      setRoutes(updated);
      const next: Record<string, Draft> = {};
      for (const entry of updated.roles) next[entry.role] = toDraft(entry.spec);
      setDrafts(next as Record<LlmRole, Draft>);
      toast.success("LLM routes imported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const providerByPrefix = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of providers) map.set(`${p.litellm_prefix}/`, p.display_name);
    return map;
  }, [providers]);

  if (loading) return <PageLoading label="Loading LLM settings…" />;
  if (error) return <PageError error={error} onRetry={load} />;
  if (!routes) return null;

  return (
    <>
      <PageHeader
        title="LLM settings"
        description="Provider catalog, role routing matrix, route health checks, and import/export."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportJson}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" /> Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Role matrix
            </CardTitle>
            <CardDescription>Configure model route and budget per role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {routes.roles.map((entry) => {
              const role = entry.role;
              const draft = drafts[role];
              const isSaving = saving.has(role);
              if (!draft) return null;
              const providerLabel =
                [...providerByPrefix.entries()].find(([prefix]) =>
                  draft.model.startsWith(prefix),
                )?.[1] ?? "custom";
              return (
                <div key={role} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={draft.enabled ? "success" : "warning"}>{role}</Badge>
                      <span className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</span>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{providerLabel}</Badge>
                      <Button size="sm" variant="outline" onClick={() => testRole(role)} disabled={isSaving}>
                        <Activity className="mr-2 h-4 w-4" /> Test
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resetRole(role)} disabled={isSaving}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Reset
                      </Button>
                      <Button size="sm" onClick={() => saveRole(role)} disabled={isSaving}>
                        <Save className="mr-2 h-4 w-4" /> {isSaving ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Label>Model</Label>
                      <Input
                        value={draft.model}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, model: e.target.value } }))
                        }
                        placeholder="openai/gpt-4.1-mini"
                      />
                    </div>
                    <div>
                      <Label>API base</Label>
                      <Input
                        value={draft.api_base}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, api_base: e.target.value } }))
                        }
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                    <div>
                      <Label className="flex items-center gap-1"><KeyRound className="h-3 w-3" /> Secret ref</Label>
                      <Input
                        value={draft.api_key_ref}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, api_key_ref: e.target.value } }))
                        }
                        placeholder="secret://openai-primary"
                      />
                    </div>
                    <div>
                      <Label>Reasoning effort</Label>
                      <Input
                        value={draft.reasoning_effort}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, reasoning_effort: e.target.value } }))
                        }
                        placeholder="low | medium | high"
                      />
                    </div>
                    <div>
                      <Label>Max tokens</Label>
                      <Input
                        inputMode="numeric"
                        value={draft.max_tokens}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, max_tokens: e.target.value } }))
                        }
                        placeholder="4096"
                      />
                    </div>
                    <div>
                      <Label>Temperature</Label>
                      <Input
                        inputMode="decimal"
                        value={draft.temperature}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, temperature: e.target.value } }))
                        }
                        placeholder="0.2"
                      />
                    </div>
                    <div>
                      <Label>Budget USD</Label>
                      <Input
                        inputMode="decimal"
                        value={draft.budget_usd}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, budget_usd: e.target.value } }))
                        }
                        placeholder="5.00"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [role]: { ...draft, enabled: e.target.checked } }))
                        }
                      />
                      Enabled
                    </label>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Providers</CardTitle>
              <CardDescription>Catalog and docs links.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {providers.map((p) => (
                <div key={p.id} className="rounded-md border border-border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{p.display_name}</div>
                    <Badge variant="outline">{p.litellm_prefix}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.default_api_base || "default endpoint from provider"}
                  </div>
                  {p.docs_url ? (
                    <a
                      href={p.docs_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Secret references</CardTitle>
              <CardDescription>Use these in route `api_key_ref` fields.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {secrets.length === 0 ? (
                <div className="text-xs text-muted-foreground">No secrets configured yet.</div>
              ) : (
                secrets.map((s) => (
                  <div key={s.name} className="rounded-md border border-border p-2 text-xs">
                    <div className="font-mono">secret://{s.name}</div>
                    <div className="text-muted-foreground">{s.preview}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>LLM audit (last 50)</CardTitle>
              <CardDescription>Recent LLM route/admin actions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {audit.length === 0 ? (
                <div className="text-xs text-muted-foreground">No LLM audit entries found.</div>
              ) : (
                audit.map((a) => (
                  <div key={a.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="font-medium">{a.action}</div>
                    <div className="text-muted-foreground">
                      {a.actor.name} · {new Date(a.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

