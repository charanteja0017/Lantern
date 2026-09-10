"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Cpu,
  Loader2,
  PlayCircle,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProvider } from "@/lib/api";
import type { CreateRunInput } from "@/lib/api/provider";
import type { LlmRole } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  { id: "nuclei-templates", label: "Nuclei templates", hint: "Community vulnerability templates" },
  { id: "ffuf", label: "FFUF", hint: "Content & parameter fuzzing" },
  { id: "sqlmap", label: "sqlmap", hint: "Automated SQL injection" },
];

type RoleOverride = { model: string; budget: string };

type ParsedTarget = { raw: string; valid: boolean };

/**
 * Targets are accepted as URLs, bare hostnames, or IPv4 literals — optionally
 * with a port and path. This is a shape check, not a reachability check: it
 * exists to catch the paste-gone-wrong case (a stray word, a truncated host)
 * before a run is queued against it, not to second-guess the operator.
 */
function parseTargets(text: string): ParsedTarget[] {
  const seen = new Set<string>();
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .map((raw) => ({ raw, valid: isPlausibleTarget(raw) }));
}

function isPlausibleTarget(value: string): boolean {
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const hostPart = withoutScheme.split(/[/?#]/)[0] ?? "";
  const host = hostPart.split(":")[0] ?? "";
  if (!host) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = host.match(ipv4);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);

  if (host === "localhost") return true;
  // Hostname: labels of alphanumerics/hyphens, at least one dot, sane TLD.
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(host);
}

export default function NewRunPage() {
  const router = useRouter();
  const [targetsText, setTargetsText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("standard");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, RoleOverride>>({});
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const parsed = useMemo(() => parseTargets(targetsText), [targetsText]);
  const targets = useMemo(() => parsed.filter((t) => t.valid).map((t) => t.raw), [parsed]);
  const invalid = useMemo(() => parsed.filter((t) => !t.valid), [parsed]);

  const overrideCount = useMemo(
    () => Object.values(overrides).filter((o) => o.model.trim()).length,
    [overrides],
  );

  const targetsDone = targets.length > 0 && invalid.length === 0;
  const canSubmit = targetsDone && !submitting;

  const removeTarget = useCallback(
    (raw: string) => {
      setTargetsText((prev) =>
        prev
          .split(/[\s,]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .filter((t) => t !== raw)
          .join("\n"),
      );
    },
    [],
  );

  const dropInvalid = useCallback(() => {
    setTargetsText(targets.join("\n"));
  }, [targets]);

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
        description="Point Lantern at a target, choose how hard to look, and launch. Everything else has a sensible default."
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
        <div className="space-y-3 lg:col-span-2">
          {/* ---------------------------------------------------------------
              Step 1 — what to scan. The only genuinely required input, so it
              leads and is the only section expanded on arrival.
              --------------------------------------------------------------- */}
          <Step
            index={1}
            title="What to scan"
            summary={
              targets.length
                ? `${targets.length} target${targets.length === 1 ? "" : "s"}`
                : "No targets yet"
            }
            complete={targetsDone}
            icon={Target}
          >
            <div className="space-y-3">
              <div>
                <Label htmlFor="targets">Targets</Label>
                <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                  URLs, hostnames, or IPs — separated by spaces, commas, or new lines.
                </p>
                <Textarea
                  id="targets"
                  value={targetsText}
                  onChange={(e) => setTargetsText(e.target.value)}
                  placeholder="https://staging.example.com&#10;api.example.com&#10;10.0.0.42"
                  rows={4}
                  required
                  aria-describedby={invalid.length ? "target-warning" : undefined}
                />
              </div>

              {parsed.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {parsed.map((t) => (
                    <span
                      key={t.raw}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]",
                        t.valid
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-severity-critical/50 bg-severity-critical/10 text-severity-critical",
                      )}
                    >
                      {!t.valid ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
                      {t.raw}
                      <button
                        type="button"
                        onClick={() => removeTarget(t.raw)}
                        aria-label={`Remove target ${t.raw}`}
                        className="ml-0.5 rounded transition-opacity hover:opacity-70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No targets yet — paste URLs above to preview them here.
                </p>
              )}

              {invalid.length > 0 ? (
                <div
                  id="target-warning"
                  role="alert"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-severity-critical/30 bg-severity-critical/10 p-2.5 text-xs text-severity-critical"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="flex-1">
                    {invalid.length} entr{invalid.length === 1 ? "y does" : "ies do"} not look
                    like a URL, hostname, or IP.
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={dropInvalid}>
                    Remove {invalid.length === 1 ? "it" : "them"}
                  </Button>
                </div>
              ) : null}

              <div>
                <Label htmlFor="instruction">Context for the agents (optional)</Label>
                <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                  Auth flows, business logic, known endpoints, or areas to stay out of.
                </p>
                <Textarea
                  id="instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={4}
                  placeholder={`Focus on:\n- JWT auth at /api/auth/*\n- Multi-tenant isolation in /api/orgs/{id}\n- Do not touch /admin/* routes`}
                />
              </div>
            </div>
          </Step>

          {/* ---------------------------------------------------------------
              Step 2 — how hard to look. Always has a valid default, so it is
              a refinement rather than a gate.
              --------------------------------------------------------------- */}
          <Step
            index={2}
            title="How hard to look"
            summary={`${labelFor(SCAN_MODES, scanMode)} · ${labelFor(SCOPE_MODES, scopeMode)} scope`}
            complete
            icon={Sparkles}
          >
            <div className="space-y-4">
              <fieldset>
                <legend className="text-xs uppercase tracking-wider text-muted-foreground">
                  Scan depth
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {SCAN_MODES.map((m) => (
                    <OptionCard
                      key={m.value}
                      name="scanMode"
                      selected={scanMode === m.value}
                      onSelect={() => setScanMode(m.value)}
                      title={m.title}
                      blurb={m.blurb}
                      meta={m.eta}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs uppercase tracking-wider text-muted-foreground">
                  Scope
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {SCOPE_MODES.map((m) => (
                    <OptionCard
                      key={m.value}
                      name="scopeMode"
                      selected={scopeMode === m.value}
                      onSelect={() => setScopeMode(m.value)}
                      title={m.title}
                      blurb={m.blurb}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          </Step>

          {/* ---------------------------------------------------------------
              Step 3 — the expert surface. Seven per-role model overrides used
              to sit between the target box and the launch button; they are
              now behind one disclosure, because almost no run needs them.
              --------------------------------------------------------------- */}
          <Step
            index={3}
            title="Advanced"
            summary={summariseAdvanced(capabilities.length, overrideCount)}
            optional
            icon={Cpu}
            open={advancedOpen}
            onToggle={setAdvancedOpen}
          >
            <div className="space-y-5">
              <fieldset>
                <legend className="text-xs uppercase tracking-wider text-muted-foreground">
                  Pre-install capabilities
                </legend>
                <p className="mb-2 mt-1 text-xs text-muted-foreground">
                  Prime the sandbox with extra offensive tooling before the run starts.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CAPABILITY_OPTIONS.map((cap) => {
                    const checked = capabilities.includes(cap.id);
                    return (
                      <label
                        key={cap.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                          checked
                            ? "border-primary/50 bg-primary/10"
                            : "border-border bg-surface/40 hover:bg-surface-2/60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setCapabilities((prev) =>
                              e.target.checked
                                ? [...prev, cap.id]
                                : prev.filter((p) => p !== cap.id),
                            )
                          }
                          className="mt-0.5 accent-[hsl(var(--primary))]"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{cap.label}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {cap.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs uppercase tracking-wider text-muted-foreground">
                  Per-role model overrides
                </legend>
                <p className="mb-2 mt-1 text-xs text-muted-foreground">
                  Blank rows fall back to the workspace defaults set by an admin.
                </p>
                <div className="space-y-2">
                  {ROLE_OVERRIDE_OPTIONS.map(({ role, label, hint }) => {
                    const o = overrides[role] ?? { model: "", budget: "" };
                    return (
                      <div
                        key={role}
                        className="grid grid-cols-1 gap-2 md:grid-cols-[130px_1fr_140px] md:items-center"
                      >
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
                          className="font-mono text-xs"
                        />
                        <Input
                          aria-label={`${label} per-run budget in USD`}
                          inputMode="decimal"
                          value={o.budget}
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [role]: { ...o, budget: e.target.value },
                            }))
                          }
                          placeholder="Budget $"
                          className="tabular-nums"
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </Step>
        </div>

        {/* -----------------------------------------------------------------
            Launch rail. Sticky, so the primary action and the exact shape of
            what is about to run stay on screen no matter how far the advanced
            section is expanded.
            ----------------------------------------------------------------- */}
        <div className="lg:col-span-1">
          <div className="space-y-3 lg:sticky lg:top-20">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ready to launch
                </div>

                <dl className="space-y-1.5 text-sm">
                  <SummaryRow
                    label="Targets"
                    value={
                      targets.length ? (
                        <span className="tabular-nums">{targets.length}</span>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )
                    }
                  />
                  <SummaryRow label="Depth" value={labelFor(SCAN_MODES, scanMode)} />
                  <SummaryRow label="Scope" value={labelFor(SCOPE_MODES, scopeMode)} />
                  <SummaryRow
                    label="Est. duration"
                    value={SCAN_MODES.find((m) => m.value === scanMode)?.eta ?? "—"}
                  />
                  {capabilities.length ? (
                    <SummaryRow
                      label="Tooling"
                      value={<span className="tabular-nums">{capabilities.length} extra</span>}
                    />
                  ) : null}
                  {overrideCount ? (
                    <SummaryRow
                      label="Model overrides"
                      value={<span className="tabular-nums">{overrideCount}</span>}
                    />
                  ) : null}
                </dl>

                {error ? (
                  <div
                    role="alert"
                    className="rounded-md border border-severity-critical/30 bg-severity-critical/10 p-3 text-xs text-severity-critical"
                  >
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

                {/* Says why the button is disabled instead of leaving the user
                    to guess — the most common support question for this form. */}
                {!targetsDone ? (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {invalid.length
                      ? "Fix or remove the flagged targets to launch."
                      : "Add at least one target to launch."}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </>
  );
}

function labelFor<T extends string>(
  options: { value: T; title: string }[],
  value: T,
): string {
  return options.find((o) => o.value === value)?.title ?? value;
}

function summariseAdvanced(caps: number, overrides: number): string {
  if (!caps && !overrides) return "Defaults";
  const parts: string[] = [];
  if (caps) parts.push(`${caps} tool${caps === 1 ? "" : "s"}`);
  if (overrides) parts.push(`${overrides} override${overrides === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

/**
 * A collapsible, numbered section. Sections with a valid default start open;
 * the optional expert section starts closed and is controlled by the parent so
 * its state can be reflected in the summary rail.
 */
function Step({
  index,
  title,
  summary,
  children,
  complete = false,
  optional = false,
  icon: Icon,
  open,
  onToggle,
}: {
  index: number;
  title: string;
  summary: string;
  children: React.ReactNode;
  complete?: boolean;
  optional?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  open?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(!optional);
  const isOpen = open ?? internalOpen;
  const setOpen = onToggle ?? setInternalOpen;
  const panelId = `step-panel-${index}`;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-surface-2/40"
      >
        <span
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors",
            complete
              ? "border-live/40 bg-live/15 text-live"
              : "border-border bg-surface-2/60 text-muted-foreground",
          )}
        >
          {complete ? <Check className="h-3.5 w-3.5" aria-hidden /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-sm font-semibold">{title}</span>
            {optional ? (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Optional
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <div id={panelId} hidden={!isOpen}>
        <CardContent className="border-t border-border pt-4">{children}</CardContent>
      </div>
    </Card>
  );
}

function OptionCard({
  name,
  selected,
  onSelect,
  title,
  blurb,
  meta,
}: {
  name: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
  meta?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col rounded-lg border p-3 transition-colors",
        selected
          ? "border-primary/50 bg-primary/10"
          : "border-border bg-surface/40 hover:bg-surface-2/60",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {/* A real radio keeps arrow-key group navigation and screen-reader
              semantics that a styled <button> would have thrown away. */}
          <input
            type="radio"
            name={name}
            checked={selected}
            onChange={onSelect}
            className="accent-[hsl(var(--primary))]"
          />
          {title}
        </span>
        {meta ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">{meta}</span>
        ) : null}
      </span>
      <span className="mt-1.5 text-xs text-muted-foreground">{blurb}</span>
    </label>
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
