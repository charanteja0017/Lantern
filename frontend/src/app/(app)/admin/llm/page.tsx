"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, KeyRound, RefreshCw, RotateCcw, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageError, PageLoading } from "@/components/common/page-state";
import { getProvider } from "@/lib/api";
import type {
  LlmRole,
  LlmRouteEntry,
  LlmRouteWrite,
  LlmRoutesRead,
} from "@/lib/types";

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

const FIELD_HINTS: Record<LlmRole, string> = {
  default: "Fallback model for any role without its own override.",
  planner: "Used for scan planning + agent decomposition (few, large calls).",
  executor: "Hottest path: per-turn agent actions. Favor a fast, cheap model.",
  reasoner: "Reserved for deliberate analysis bursts. A stronger model pays off.",
  reporter: "Final report synthesis. Quality > cost; only runs once per scan.",
  vision: "Multimodal image analysis via view_image. Must support image input.",
  memory: "Conversation compression + summarization. Short context, latency-sensitive.",
  dedupe: "Finding deduplication. Very short prompts; cheapest model is fine.",
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

export default function AdminLlmPage() {
  const [data, setData] = useState<LlmRoutesRead | null>(null);
  const [drafts, setDrafts] = useState<Record<LlmRole, Draft>>({} as Record<LlmRole, Draft>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Set<LlmRole>>(new Set());
  const [error, setError] = useState<Error | null>(null);

  const refetch = useMemo(
    () => () => {
      setLoading(true);
      setError(null);
      getProvider()
        .listLlmRoutes()
        .then((res) => {
          setData(res);
          const next: Record<string, Draft> = {};
          for (const entry of res.roles) next[entry.role] = toDraft(entry.spec);
          setDrafts(next as Record<LlmRole, Draft>);
        })
        .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  const markSaving = (role: LlmRole, on: boolean) => {
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(role);
      else next.delete(role);
      return next;
    });
  };

  const saveRole = async (role: LlmRole) => {
    const draft = drafts[role];
    if (!draft) return;
    const payload = draftToWrite(role, draft);
    if (!payload) {
      toast.error(`Model is required for the "${role}" role.`);
      return;
    }
    markSaving(role, true);
    try {
      const res = await getProvider().saveLlmRoutes({ routes: { [role]: payload } });
      setData(res);
      toast.success(`Updated ${role} route`);
      const entry = res.roles.find((r) => r.role === role);
      if (entry) {
        setDrafts((prev) => ({ ...prev, [role]: toDraft(entry.spec) }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save route");
    } finally {
      markSaving(role, false);
    }
  };

  const testRole = async (role: LlmRole) => {
    markSaving(role, true);
    try {
      const res = await getProvider().testLlmRoute(role);
      if (res.ok) {
        toast.success(
          `${role} OK in ${res.latency_ms ?? "?"}ms${res.model ? ` (${res.model})` : ""}`,
        );
      } else {
        toast.error(res.error || `${role} test failed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Route test failed");
    } finally {
      markSaving(role, false);
    }
  };

  const resetRole = async (role: LlmRole) => {
    markSaving(role, true);
    try {
      const res = await getProvider().deleteLlmRoute(role);
      setData(res);
      const entry = res.roles.find((r) => r.role === role);
      if (entry) setDrafts((prev) => ({ ...prev, [role]: toDraft(entry.spec) }));
      toast.success(`Reset ${role} to fallback`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset route");
    } finally {
      markSaving(role, false);
    }
  };

  if (loading) return <PageLoading label="Loading LLM routes…" />;
  if (error) return <PageError error={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant="danger" className="uppercase">
          <ShieldAlert className="h-3 w-3" /> platform-admin
        </Badge>
        <span className="text-xs text-muted-foreground">
          Changes here apply to every new LLM call across all runs.
        </span>
      </div>
      <PageHeader
        title="LLM role routing"
        description="Send each agent role to the model best suited for it. Short prompts (executor/dedupe/memory) should favor cheap fast models; reasoning and reporting roles can use stronger models."
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4">
        {data.roles.map((entry) => {
          const role = entry.role;
          const draft = drafts[role];
          if (!draft) return null;
          const isSaving = saving.has(role);
          return (
            <Card key={role}>
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Badge variant={entry.spec.enabled ? "success" : "warning"}>
                      {role}
                    </Badge>
                    <span className="text-sm font-mono text-muted-foreground">
                      {entry.spec.model || "(unset — using env fallback)"}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {entry.description || FIELD_HINTS[role]}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testRole(role)}
                    disabled={isSaving}
                  >
                    <Activity className="mr-2 h-4 w-4" /> Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resetRole(role)}
                    disabled={isSaving}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset
                  </Button>
                  <Button size="sm" onClick={() => saveRole(role)} disabled={isSaving}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor={`${role}-model`}>Model</Label>
                  <Input
                    id={`${role}-model`}
                    value={draft.model}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [role]: { ...draft, model: e.target.value } }))
                    }
                    placeholder="openai/gpt-4.1-mini"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    LiteLLM model id. Examples: <code>openai/gpt-4.1-mini</code>,{" "}
                    <code>anthropic/claude-3-5-sonnet</code>, <code>gemini/gemini-2.0-pro</code>,{" "}
                    <code>ollama/llama3.1</code>.
                  </p>
                </div>
                <div>
                  <Label htmlFor={`${role}-base`}>API base (optional)</Label>
                  <Input
                    id={`${role}-base`}
                    value={draft.api_base}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, api_base: e.target.value },
                      }))
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div>
                  <Label htmlFor={`${role}-key`} className="flex items-center gap-1">
                    <KeyRound className="h-3 w-3" /> API key reference
                  </Label>
                  <Input
                    id={`${role}-key`}
                    value={draft.api_key_ref}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, api_key_ref: e.target.value },
                      }))
                    }
                    placeholder="secret://openai-primary"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reference name only. Plaintext keys are never accepted here — they live in the
                    encrypted secret store.
                  </p>
                </div>
                <div>
                  <Label htmlFor={`${role}-effort`}>Reasoning effort</Label>
                  <Input
                    id={`${role}-effort`}
                    value={draft.reasoning_effort}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, reasoning_effort: e.target.value },
                      }))
                    }
                    placeholder="low | medium | high"
                  />
                </div>
                <div>
                  <Label htmlFor={`${role}-maxtokens`}>Max tokens</Label>
                  <Input
                    id={`${role}-maxtokens`}
                    inputMode="numeric"
                    value={draft.max_tokens}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, max_tokens: e.target.value },
                      }))
                    }
                    placeholder="4096"
                  />
                </div>
                <div>
                  <Label htmlFor={`${role}-temp`}>Temperature</Label>
                  <Input
                    id={`${role}-temp`}
                    inputMode="decimal"
                    value={draft.temperature}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, temperature: e.target.value },
                      }))
                    }
                    placeholder="0.2"
                  />
                </div>
                <div>
                  <Label htmlFor={`${role}-budget`}>Per-run budget (USD)</Label>
                  <Input
                    id={`${role}-budget`}
                    inputMode="decimal"
                    value={draft.budget_usd}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, budget_usd: e.target.value },
                      }))
                    }
                    placeholder="5.00"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Empty = no cap. The router aborts calls for this role once the per-run spend
                    reaches the cap.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id={`${role}-enabled`}
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [role]: { ...draft, enabled: e.target.checked },
                      }))
                    }
                  />
                  <Label htmlFor={`${role}-enabled`}>Enabled (fall back to default if off)</Label>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
