"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Cpu, Loader2, PlayCircle, Sparkles, Target } from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { getProvider } from "@/lib/api";
import type { CreateRunInput } from "@/lib/api/provider";
import type { LlmRole } from "@/lib/types";

type ScanMode = CreateRunInput["scanMode"];
type ScopeMode = CreateRunInput["scopeMode"];

const SCAN_MODES: { value: ScanMode; title: string; blurb: string; eta: string }[] = [
  {
    value: "quick",
    title: "Quick",
    blurb: "Fast surface scan. Great for smoke-testing a target.",
    eta: "≈ 5 min",
  },
  {
    value: "standard",
    title: "Standard",
    blurb: "Balanced depth. Covers common web & API attack surface.",
    eta: "≈ 20 min",
  },
  {
    value: "deep",
    title: "Deep",
    blurb: "Exhaustive multi-agent run with iterative exploitation.",
    eta: "60+ min",
  },
];

const SCOPE_MODES: { value: ScopeMode; title: string; blurb: string }[] = [
  {
    value: "auto",
    title: "Auto",
    blurb: "Agents decide scope based on reachable assets.",
  },
  {
    value: "diff",
    title: "Diff",
    blurb: "Only test new / changed endpoints vs. the previous run.",
  },
  {
    value: "full",
    title: "Full",
    blurb: "Crawl and test every reachable endpoint.",
  },
];

const ROLE_OVERRIDE_OPTIONS: { role: LlmRole; label: string; hint: string }[] = [
  { role: "planner", label: "Planner", hint: "Scan planning + decomposition" },
  { role: "executor", label: "Executor", hint: "Per-turn agent actions (hot path)" },
  { role: "reasoner", label: "Reasoner", hint: "Deliberate analysis bursts" },
  { role: "reporter", label: "Reporter", hint: "Final report synthesis" },
  { role: "vision", label: "Vision", hint: "Image analysis / view_image" },
  { role: "memory", label: "Memory", hint: "Conversation compression" },
  { role: "dedupe", label: "Dedupe", hint: "Finding deduplication" },
];

const CAPABILITY_OPTIONS = [
  { id: "nuclei-templates", label: "Nuclei templates" },
  { id: "ffuf", label: "FFUF" },
  { id: "sqlmap", label: "sqlmap" },
];

type RoleOverride = { model: string; budget: string };

export default function NewRunPage() {
  const router = useRouter();
  const [targetsText, setTargetsText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("standard");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmOpen, setLlmOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, RoleOverride>>({});
  const [capabilities, setCapabilities] = useState<string[]>([]);

  const targets = useMemo(
    () =>
      targetsText
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    [targetsText],
  );

  const canSubmit = targets.length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const llmOverrides = buildLlmOverrides(overrides);
    try {
      const injectedInstruction = [
        instruction.trim() || "",
        capabilities.length
          ? `\n[preinstall_capabilities]\n${capabilities.join(",")}\n[/preinstall_capabilities]`
          : "",
      ]
        .join("")
        .trim();
      const run = await getProvider().createRun({
        targets,
        instruction: injectedInstruction || undefined,
        scanMode,
        scopeMode,
        llmOverrides: Object.keys(llmOverrides).length ? llmOverrides : undefined,
      });
      if (!run?.id) {
        throw new Error(
          "Run was accepted but the server did not return a run id. Check the API logs.",
        );
      }
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create run");
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New scan"
        description="Configure a pentest run. NovaHunter will orchestrate autonomous agents against your targets and stream findings in real time."
        actions={
          <Link href="/runs">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" />
              Back to runs
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Targets
              </CardTitle>
              <CardDescription>
                One or more URLs, hostnames, or IPs. Separate with spaces, commas, or new lines.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={targetsText}
                onChange={(e) => setTargetsText(e.target.value)}
                placeholder="https://staging.example.com&#10;api.example.com&#10;10.0.0.42"
                rows={4}
                required
                aria-label="Targets"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {targets.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No targets yet — paste URLs above to preview.
                  </span>
                ) : (
                  targets.map((t) => (
                    <Badge key={t} variant="default" className="font-mono text-[11px]">
                      {t}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  LLM overrides (optional)
                </CardTitle>
                <CardDescription>
                  Override which model each agent role uses for this run. Blank rows fall back to the
                  admin defaults.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLlmOpen((v) => !v)}
              >
                {llmOpen ? "Hide" : "Configure"}
              </Button>
            </CardHeader>
            {llmOpen ? (
              <CardContent className="space-y-3">
                {ROLE_OVERRIDE_OPTIONS.map(({ role, label, hint }) => {
                  const o = overrides[role] ?? { model: "", budget: "" };
                  return (
                    <div key={role} className="grid grid-cols-1 gap-2 md:grid-cols-[120px_1fr_140px]">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{label}</span>
                        <span className="text-[11px] text-muted-foreground">{hint}</span>
                      </div>
                      <Input
                        aria-label={`${label} model override`}
                        value={o.model}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [role]: { ...o, model: e.target.value },
                          }))
                        }
                        placeholder="openai/gpt-4.1-mini"
                      />
                      <Input
                        aria-label={`${label} per-run budget USD`}
                        inputMode="decimal"
                        value={o.budget}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [role]: { ...o, budget: e.target.value },
                          }))
                        }
                        placeholder="Budget $ (optional)"
                      />
                    </div>
                  );
                })}
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Instructions
              </CardTitle>
              <CardDescription>
                Optional. Guide agents with context: auth flows, business logic, known endpoints,
                out-of-scope areas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Label htmlFor="instruction" className="sr-only">
                Instructions
              </Label>
              <Textarea
                id="instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={6}
                placeholder={`Focus on:\n- JWT auth at /api/auth/*\n- Multi-tenant isolation in /api/orgs/{id}\n- Do not touch /admin/* routes`}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pre-install capabilities</CardTitle>
              <CardDescription>
                Prime the sandbox with additional offensive tooling before the run starts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {CAPABILITY_OPTIONS.map((cap) => (
                <label key={cap.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={capabilities.includes(cap.id)}
                    onChange={(e) =>
                      setCapabilities((prev) =>
                        e.target.checked ? [...prev, cap.id] : prev.filter((p) => p !== cap.id),
                      )
                    }
                  />
                  <span>{cap.label}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scan depth</CardTitle>
              <CardDescription>Trades off speed for coverage.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {SCAN_MODES.map((m) => (
                <OptionRow
                  key={m.value}
                  selected={scanMode === m.value}
                  onClick={() => setScanMode(m.value)}
                  title={m.title}
                  blurb={m.blurb}
                  meta={m.eta}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scope</CardTitle>
              <CardDescription>Which surface to exercise.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {SCOPE_MODES.map((m) => (
                <OptionRow
                  key={m.value}
                  selected={scopeMode === m.value}
                  onClick={() => setScopeMode(m.value)}
                  title={m.title}
                  blurb={m.blurb}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              {error ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  {error}
                </div>
              ) : null}
              <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                {submitting ? "Launching…" : "Launch scan"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                {targets.length} target{targets.length === 1 ? "" : "s"} · {scanMode} ·{" "}
                {scopeMode}
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </>
  );
}

function buildLlmOverrides(
  draft: Record<string, RoleOverride>,
): NonNullable<CreateRunInput["llmOverrides"]> {
  const out: NonNullable<CreateRunInput["llmOverrides"]> = {};
  for (const [role, entry] of Object.entries(draft)) {
    const model = entry.model.trim();
    if (!model) continue;
    const budgetRaw = entry.budget.trim();
    const budget = budgetRaw ? Number(budgetRaw) : null;
    out[role] = {
      model,
      budget_usd: budget != null && Number.isFinite(budget) ? budget : null,
    };
  }
  return out;
}

function OptionRow({
  selected,
  onClick,
  title,
  blurb,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
  meta?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-primary/50 bg-primary/10"
          : "border-border bg-surface/40 hover:bg-surface-2/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        {meta ? <div className="text-[11px] text-muted-foreground">{meta}</div> : null}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{blurb}</div>
    </button>
  );
}
