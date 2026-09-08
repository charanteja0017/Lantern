"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Book,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  FileText,
  Github,
  Info,
  Keyboard,
  Lock,
  PlayCircle,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { StrixLogo } from "@/components/common/logo";
import { config } from "@/lib/config";
import { AuthorizeButton } from "./authorize-dialog";
import { TryIt } from "./try-it";
import { GROUPS, type Endpoint, type Group, type Method } from "./endpoints";

const BASE_URL = `${config.apiHost}/v1`;
const ENV_VAR = "NOVAHUNTER_API_KEY";

/* ──────────────────────────────────────────────────────────────────────────
 * Page
 * ──────────────────────────────────────────────────────────────────────── */

export default function DocsPage() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>("overview");

  const filtered = useMemo(() => {
    if (!query.trim()) return GROUPS;
    const q = query.toLowerCase();
    return GROUPS.map((g) => ({
      ...g,
      endpoints: g.endpoints.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.method.toLowerCase().includes(q),
      ),
    })).filter((g) => g.endpoints.length > 0);
  }, [query]);

  useEffect(() => {
    const ids = [
      "overview",
      "authentication",
      "rate-limits",
      "errors",
      ...GROUPS.flatMap((g) => [g.id, ...g.endpoints.map((e) => e.id)]),
    ];
    const observers: IntersectionObserver[] = [];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) setActiveId(id);
          });
        },
        { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.getElementById("docs-search") as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <DocsBackdrop />

      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <StrixLogo size={22} />
            <span className="text-sm font-semibold tracking-tight">{config.appName}</span>
            <span className="ml-1 rounded-md border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              API v1
            </span>
          </Link>

          <div className="ml-4 hidden h-5 w-px bg-border md:block" />
          <span className="hidden text-xs text-muted-foreground md:inline">REST · JSON · SSE</span>

          <div className="relative ml-auto hidden w-80 md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="docs-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search endpoints…"
              className="h-9 w-full rounded-md border border-border bg-surface-2/60 pl-8 pr-16 text-sm outline-none transition-colors focus:border-primary/50"
            />
            <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex">
              <Keyboard className="h-3 w-3" />K
            </kbd>
          </div>

          <AuthorizeButton />

          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-3 text-sm transition-colors hover:bg-surface-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-border bg-surface/40 p-4 lg:block scrollbar-thin">
          <nav className="text-sm">
            <NavSection title="Introduction">
              <NavLink href="#overview" active={activeId === "overview"} icon={Book}>
                Overview
              </NavLink>
              <NavLink href="#authentication" active={activeId === "authentication"} icon={Lock}>
                Authentication
              </NavLink>
              <NavLink href="#rate-limits" active={activeId === "rate-limits"} icon={Zap}>
                Rate limits
              </NavLink>
              <NavLink href="#errors" active={activeId === "errors"} icon={ShieldAlert}>
                Errors
              </NavLink>
            </NavSection>

            {filtered.map((g) => (
              <NavSection key={g.id} title={g.title}>
                {g.endpoints.map((e) => (
                  <NavLink key={e.id} href={`#${e.id}`} active={activeId === e.id}>
                    <MethodDot method={e.method} />
                    <span className="truncate">{e.title}</span>
                  </NavLink>
                ))}
              </NavSection>
            ))}

            <div className="mt-6 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                <Sparkles className="h-3 w-3 text-primary" />
                Need help?
              </div>
              Reach{" "}
              <a
                href={`mailto:support@${config.brandDomain}`}
                className="text-primary hover:underline"
              >
                support@{config.brandDomain}
              </a>{" "}
              for rate-limit bumps or missing endpoints.
            </div>
          </nav>
        </aside>

        {/* Main */}
        <main className="min-w-0 px-6 py-10 lg:px-10">
          {/* Hero */}
          <div className="mb-10 rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card/60 to-fuchsia-500/10 p-8 shadow-[0_0_60px_-30px_hsl(var(--primary)/0.6)]">
            <div className="flex flex-wrap items-start gap-6 md:flex-nowrap">
              <div className="flex-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                  <Circle className="h-2 w-2 animate-pulse fill-current" />
                  Production · stable
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                  {config.appName} API reference
                </h1>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
                  Start scans, stream findings, and download reports programmatically. Every endpoint
                  is testable right from this page — authorize with your API key and click{" "}
                  <span className="font-mono text-foreground">Send</span>.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs">
                  <HeroPill icon={Terminal} label="REST + JSON" />
                  <HeroPill icon={PlayCircle} label="Built-in playground" />
                  <HeroPill icon={Lock} label="Bearer authentication" />
                  <HeroPill icon={FileText} label="9 public endpoints" />
                </div>
              </div>
              <div className="w-full shrink-0 md:w-[340px]">
                <div className="rounded-lg border border-border bg-[#0b1020] p-3 shadow-lg">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-red-500/80" />
                    <span className="h-2 w-2 rounded-full bg-amber-400/80" />
                    <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
                    <span className="ml-auto font-mono">quick-start</span>
                  </div>
                  <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-foreground/90 scrollbar-thin">
                    <code>{`$ export ${ENV_VAR}=novahunter_live_sk_...
$ curl ${BASE_URL}/runs \\
    -H "Authorization: Bearer $${ENV_VAR}"
{
  "data": [...],
  "next_cursor": null
}`}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* Introduction sections */}
          <Section id="overview" title="Overview" eyebrow="Introduction" icon={Book}>
            <p>
              The {config.appName} REST API lets you start autonomous penetration tests, retrieve
              findings, and download audit-ready reports — programmatically.
            </p>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Base URL: <InlineCode>{BASE_URL}</InlineCode> (override in{" "}
                <InlineCode>Authorize</InlineCode> if self-hosting)
              </li>
              <li>All requests must be made over HTTPS.</li>
              <li>Payloads are JSON unless otherwise stated (event streams are SSE).</li>
              <li>All times are ISO-8601 in UTC.</li>
              <li>
                API versioning is in the URL path (<InlineCode>/v1</InlineCode>). Breaking changes ship
                as a new major version.
              </li>
            </ul>
            <Callout icon={Info} tone="info">
              Looking for the live dashboard, scan viewer, or team settings? Head back to the
              <Link href="/dashboard" className="ml-1 text-primary hover:underline">
                dashboard
              </Link>
              .
            </Callout>
          </Section>

          <Section id="authentication" title="Authentication" eyebrow="Introduction" icon={Lock}>
            <p>
              Authenticate every request with an API key issued from your workspace. Pass it as a
              bearer token in the <InlineCode>Authorization</InlineCode> header.
            </p>
            <CodeBlock
              language="http"
              code={`Authorization: Bearer novahunter_live_sk_...`}
            />
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Keys are scoped to a single workspace.</li>
              <li>Keys are shown only once; copy them at creation time.</li>
              <li>Rotate keys at least every 90 days, or any time you suspect compromise.</li>
              <li>
                Manage keys from{" "}
                <Link href="/profile?tab=api-keys" className="text-primary hover:underline">
                  Profile → API keys
                </Link>
                .
              </li>
            </ul>
            <Callout icon={Lock} tone="warn">
              Never embed API keys in client-side code, mobile apps, or public repos. All calls must
              be made from a server you control.
            </Callout>
          </Section>

          <Section id="rate-limits" title="Rate limits" eyebrow="Introduction" icon={Zap}>
            <p>
              Every workspace has a rolling-window request limit and a concurrent-run limit. Limits
              apply across all keys in a workspace.
            </p>
            <div className="mt-5 overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-2/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Tier</th>
                    <th className="px-4 py-2">Requests / min</th>
                    <th className="px-4 py-2">Concurrent runs</th>
                    <th className="px-4 py-2">Report downloads / day</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["Free trial", "60", "1", "10"],
                    ["Team", "600", "5", "500"],
                    ["Enterprise", "Custom", "Custom", "Custom"],
                  ].map((r) => (
                    <tr key={r[0]}>
                      <td className="px-4 py-2 font-medium">{r[0]}</td>
                      <td className="px-4 py-2 font-mono text-sm">{r[1]}</td>
                      <td className="px-4 py-2 font-mono text-sm">{r[2]}</td>
                      <td className="px-4 py-2 font-mono text-sm">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Every response includes the following headers so your client can back off gracefully:
            </p>
            <CodeBlock
              language="http"
              code={`X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1745159400
Retry-After: 12`}
            />
            <Callout icon={Zap} tone="info">
              When you exceed a limit the API returns <InlineCode>429 Too Many Requests</InlineCode>.
              Wait at least <InlineCode>Retry-After</InlineCode> seconds before retrying and implement
              exponential backoff with jitter.
            </Callout>
            <Callout icon={ShieldAlert} tone="warn">
              Responses from this API are proprietary to your workspace. Scraping, reselling, or
              republishing API data outside your organisation is prohibited by the terms of service.
            </Callout>
          </Section>

          <Section id="errors" title="Errors" eyebrow="Introduction" icon={ShieldAlert}>
            <p>
              The API uses standard HTTP status codes and returns a JSON body describing the error.
            </p>
            <CodeBlock
              language="json"
              code={`{
  "error": {
    "code": "invalid_request",
    "message": "targets must contain at least one URL",
    "request_id": "req_01H",
    "docs_url": "https://${config.brandDomain}/docs#errors"
  }
}`}
            />
            <div className="mt-5 grid gap-2 text-sm md:grid-cols-2">
              {[
                ["400", "invalid_request", "Malformed JSON or failed validation."],
                ["401", "unauthenticated", "Missing or invalid API key."],
                ["403", "forbidden", "Authenticated key lacks access to the resource."],
                ["404", "not_found", "The resource does not exist in your workspace."],
                ["409", "conflict", "Run is already in a terminal state."],
                ["429", "rate_limited", "You exceeded the rate limit. See Retry-After."],
                ["500", "internal_error", "Unexpected failure. Retry with backoff."],
                ["503", "unavailable", "Temporary capacity limit. Retry later."],
              ].map(([code, key, msg]) => (
                <div key={code} className="flex gap-3 rounded-md border border-border bg-card/50 p-3">
                  <span className="mt-0.5 inline-flex h-6 w-10 shrink-0 items-center justify-center rounded bg-surface-2 font-mono text-xs">
                    {code}
                  </span>
                  <div>
                    <div className="font-mono text-xs text-primary">{key}</div>
                    <div className="text-muted-foreground">{msg}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {filtered.map((group) => (
            <GroupSection key={group.id} group={group} />
          ))}

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No endpoints match <span className="font-mono">{query}</span>.
            </div>
          ) : null}

          <footer className="mt-20 border-t border-border py-8 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                © {new Date().getFullYear()} {config.appName} · API v1 ·{" "}
                {GROUPS.reduce((n, g) => n + g.endpoints.length, 0)} endpoints documented
              </div>
              <div className="flex items-center gap-4">
                <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
                <Link href="/profile?tab=api-keys" className="hover:text-foreground">API keys</Link>
                <a href={`mailto:support@${config.brandDomain}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  support@{config.brandDomain} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-[11px]">
              <span>Agent core powered by the open-source</span>
              <a
                href={config.upstream.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono text-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Github className="h-3 w-3" />
                {config.upstream.org}/strix
              </a>
              <span>project. Credit to the original Strix Agent authors.</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Group section + endpoint card
 * ──────────────────────────────────────────────────────────────────────── */

function GroupSection({ group }: { group: Group }) {
  return (
    <div>
      <h2
        id={group.id}
        className="scroll-mt-24 mt-16 border-t border-border pt-10 text-2xl font-semibold tracking-tight"
      >
        {group.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{group.summary}</p>
      <div className="mt-6 space-y-14">
        {group.endpoints.map((e) => (
          <EndpointDoc key={e.id} endpoint={e} />
        ))}
      </div>
    </div>
  );
}

function EndpointDoc({ endpoint }: { endpoint: Endpoint }) {
  const [tab, setTab] = useState<"docs" | "try">("docs");
  const [lang, setLang] = useState<"curl" | "python" | "node">("curl");

  const curl = buildCurl(endpoint);
  const python = buildPython(endpoint);
  const node = buildNode(endpoint);
  const code = lang === "curl" ? curl : lang === "python" ? python : node;

  return (
    <article
      id={endpoint.id}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card/40 shadow-sm transition-shadow hover:shadow-lg"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface/30 px-5 py-3">
        <MethodPill method={endpoint.method} />
        <code className="flex-1 truncate font-mono text-sm text-foreground" title={endpoint.path}>
          {endpoint.path}
        </code>
        <CopyInline text={endpoint.path} />
        <a
          href={`#${endpoint.id}`}
          className="hidden rounded text-xs text-muted-foreground hover:text-foreground md:inline"
          aria-label="Anchor link"
        >
          #{endpoint.id}
        </a>
      </header>

      <div className="border-b border-border px-5 pt-5">
        <h3 className="text-base font-semibold tracking-tight">{endpoint.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{endpoint.description}</p>
        {endpoint.notes ? (
          <div className="mt-3 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {endpoint.notes}
          </div>
        ) : null}

        {/* Tabs */}
        <div className="mt-4 flex items-center gap-1 border-b border-border">
          <TabButton active={tab === "docs"} onClick={() => setTab("docs")} icon={Book}>
            Docs
          </TabButton>
          <TabButton active={tab === "try"} onClick={() => setTab("try")} icon={PlayCircle}>
            Try it
          </TabButton>
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1fr]">
        {tab === "docs" ? (
          <>
            <div>
              {endpoint.params && endpoint.params.length > 0 ? (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Parameters
                  </h4>
                  <ul className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
                    {endpoint.params.map((p) => (
                      <li key={`${p.in}-${p.name}`} className="p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-[13px] font-medium">{p.name}</code>
                          <span className="rounded bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {p.type}
                          </span>
                          <span className="rounded bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                            {p.in}
                          </span>
                          {p.required && (
                            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                              required
                            </span>
                          )}
                          {p.default && (
                            <span className="rounded bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              default: {p.default}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                        {p.example && (
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            Example: <span className="text-foreground/80">{p.example}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This endpoint takes no parameters.</p>
              )}

              {endpoint.requestBodyExample ? (
                <div className="mt-5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Request body
                  </h4>
                  <div className="mt-2">
                    <CodeBlock language="json" code={endpoint.requestBodyExample} />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  {(["curl", "python", "node"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                        lang === l
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border bg-surface-2/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {l === "curl" ? "cURL" : l === "python" ? "Python" : "Node.js"}
                    </button>
                  ))}
                </div>
                <CodeBlock language={lang} code={code} />
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <ChevronRight className="h-3 w-3" />
                  Response
                </div>
                <CodeBlock language="json" code={endpoint.responseExample} />
              </div>
            </div>
          </>
        ) : (
          <div className="lg:col-span-2">
            <TryIt endpoint={endpoint} />
          </div>
        )}
      </div>
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Small building blocks
 * ──────────────────────────────────────────────────────────────────────── */

function DocsBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[460px] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[260px] bg-[linear-gradient(to_right,hsl(var(--border)/0.15)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.15)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
    </>
  );
}

function HeroPill({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-foreground/80 backdrop-blur-sm">
      <Icon className="h-3 w-3 text-primary" />
      {label}
    </span>
  );
}

function Section({
  id,
  title,
  eyebrow,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-border/50 pb-10 pt-4 first:pt-0">
      {eyebrow ? (
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {Icon ? <Icon className="h-3 w-3" /> : null}
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="prose-invert mt-4 max-w-3xl text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center gap-1 rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open ? <div className="space-y-0.5">{children}</div> : null}
    </div>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`flex items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
        active
          ? "bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]"
          : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground"
      }`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
      {children}
    </a>
  );
}

function MethodDot({ method }: { method: Method }) {
  const map: Record<Method, string> = {
    GET: "bg-emerald-500",
    POST: "bg-sky-500",
    DELETE: "bg-red-500",
  };
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${map[method]}`} />;
}

function MethodPill({ method }: { method: Method }) {
  const map: Record<Method, string> = {
    GET: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    POST: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    DELETE: "bg-red-500/15 text-red-300 border-red-500/30",
  };
  return (
    <span
      className={`inline-flex h-6 items-center rounded-md border px-2 font-mono text-[11px] font-semibold uppercase ${map[method]}`}
    >
      {method}
    </span>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono text-[12px]">
      {children}
    </code>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Callout({
  icon: Icon,
  tone = "info",
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: "info" | "warn";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
      : "border-sky-500/30 bg-sky-500/5 text-sky-100";
  return (
    <div className={`mt-5 flex gap-3 rounded-lg border p-4 text-sm ${toneClass}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-[#0b1020]">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{language}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-surface-2/60 hover:text-foreground"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed text-foreground/90 scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground"
      aria-label={copied ? "Copied" : "Copy"}
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Code sample builders
 * ──────────────────────────────────────────────────────────────────────── */

function buildCurl(endpoint: Endpoint): string {
  const url = `${BASE_URL}${endpoint.path.replace(/^\/v1/, "")}`;
  const flags: string[] = [];
  if (endpoint.method !== "GET") flags.push(`-X ${endpoint.method}`);
  flags.push(`-H "Authorization: Bearer $${ENV_VAR}"`);
  if (endpoint.requestBodyExample) {
    flags.push(`-H "Content-Type: application/json"`);
    flags.push(`-d '${endpoint.requestBodyExample.replace(/'/g, "'\\''")}'`);
  }
  return `curl ${flags.join(" \\\n  ")} \\\n  "${url}"`;
}

function buildPython(endpoint: Endpoint): string {
  const url = `${BASE_URL}${endpoint.path.replace(/^\/v1/, "")}`;
  const body = endpoint.requestBodyExample ? `,\n    json=${endpoint.requestBodyExample}` : "";
  const fn = endpoint.method === "GET" ? "get" : "post";
  return `import os, requests

res = requests.${fn}(
    "${url}",
    headers={"Authorization": f"Bearer {os.environ['${ENV_VAR}']}"}${body},
    timeout=30,
)
res.raise_for_status()
print(res.json())`;
}

function buildNode(endpoint: Endpoint): string {
  const url = `${BASE_URL}${endpoint.path.replace(/^\/v1/, "")}`;
  const body = endpoint.requestBodyExample
    ? `,\n  body: JSON.stringify(${endpoint.requestBodyExample})`
    : "";
  const contentType = endpoint.requestBodyExample ? `,\n    "Content-Type": "application/json"` : "";
  return `const res = await fetch("${url}", {
  method: "${endpoint.method}",
  headers: {
    Authorization: \`Bearer \${process.env.${ENV_VAR}}\`${contentType}
  }${body}
});
if (!res.ok) throw new Error(await res.text());
console.log(await res.json());`;
}
