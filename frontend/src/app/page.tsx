import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cloud,
  FileSearch,
  FileText,
  GitBranch,
  Github,
  Globe2,
  Heart,
  KeyRound,
  Lock,
  Network,
  Play,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StrixLogo } from "@/components/common/logo";
import { AttackTerminal } from "@/components/landing/attack-terminal";
import { AgentTree } from "@/components/landing/agent-tree";
import { FindingsStream } from "@/components/landing/findings-stream";
import { CountUp, Reveal } from "@/components/landing/reveal";
import { CopyCommand } from "@/components/landing/copy-command";
import { config } from "@/lib/config";

const features = [
  {
    icon: Activity,
    title: "Live multi-agent scans",
    desc: "Watch every thought, tool call, and finding stream in real time across a tree of specialised sub-agents.",
  },
  {
    icon: ShieldCheck,
    title: "Enterprise SSO & RBAC",
    desc: "SAML, OIDC, and Google Workspace in one click. Least-privilege roles, auditable access, per-workspace isolation.",
  },
  {
    icon: Zap,
    title: "Rate-limit aware",
    desc: "Built-in TPM/RPM governor with queueing, backoff, and user-visible throttling for every supported LLM provider.",
  },
  {
    icon: Terminal,
    title: "Resumable sessions",
    desc: "Crash-safe checkpoints. Close the tab, change devices, come back a week later — resume exactly where you left off.",
  },
  {
    icon: Cloud,
    title: "Your keys, your cloud",
    desc: "Bring Anthropic, OpenAI, or a private Ollama endpoint. Secrets never leave your tenant; egress is allow-listed.",
  },
  {
    icon: FileText,
    title: "Shareable reports",
    desc: "Every run produces a branded report with PoC, evidence, CVE/CWE mappings, and remediation — ready to ship to engineering.",
  },
];

const attackClasses = [
  { icon: Bot, label: "IDOR & BOLA" },
  { icon: Lock, label: "Auth bypass" },
  { icon: FileSearch, label: "SSRF / SSTI" },
  { icon: Network, label: "Network pivoting" },
  { icon: Target, label: "Privilege escalation" },
  { icon: ScanSearch, label: "Supply-chain" },
  { icon: Globe2, label: "OWASP Top 10" },
  { icon: GitBranch, label: "Source-code review" },
];

const steps = [
  {
    num: "01",
    icon: Target,
    title: "Point it at a target",
    desc: "A URL, an API spec, or a git repo. Scope modes keep the agent inside the rails you define.",
  },
  {
    num: "02",
    icon: Bot,
    title: "Agents go to work",
    desc: "A root agent recons, spawns specialists, and orchestrates tool calls. You watch the whole nova live.",
  },
  {
    num: "03",
    icon: FileText,
    title: "Get a shareable report",
    desc: "Every finding ships with PoC, evidence, severity, CVE/CWE and remediation — ready for engineering.",
  },
];

const metrics = [
  { value: 42, suffix: "+", label: "Attack classes" },
  { value: 97, suffix: "%", label: "Reproducible PoCs" },
  { value: 15, suffix: "×", label: "Faster triage" },
  { value: 3, suffix: "m", label: "To first finding" },
];

export default function LandingPage() {
  return (
    <div className="relative overflow-x-hidden">
      <div className="aurora" aria-hidden />
      <div className="hero-grid" aria-hidden />

      {/* Nav */}
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 md:px-6 md:py-5">
        <Link href="/" className="flex items-center gap-2">
          <StrixLogo size={28} />
          <span className="text-sm font-semibold tracking-tight">{config.appName}</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#demo" className="transition-colors hover:text-foreground">Live demo</a>
          <a href="#features" className="transition-colors hover:text-foreground">Features</a>
          <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
          <a href="#security" className="transition-colors hover:text-foreground">Security</a>
          <Link href="/docs" className="transition-colors hover:text-foreground">API</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden sm:inline-flex">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">
              Get started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl gap-8 px-4 pb-16 pt-8 md:gap-10 md:px-6 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <Reveal className="flex flex-col justify-center">
          <Badge variant="primary" className="mb-6 w-fit">
            <Sparkles className="h-3 w-3" /> AI-native offensive security
          </Badge>
          <h1 className="max-w-2xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Autonomous pentest agents.{" "}
            <span className="shimmer-text">Cinematic control plane.</span>
          </h1>
          <p className="mt-5 max-w-xl text-balance text-base text-muted-foreground md:text-lg">
            {config.appName} ships a team of specialised offensive-security agents that find
            real vulnerabilities on your apps, APIs, and code — live, reproducible, and
            remediation-ready.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/sign-up">
              <Button size="lg">
                Start free trial <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="outline">
                <Play className="h-4 w-4" />
                See it in action
              </Button>
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <CopyCommand command="curl -sSL https://novahunter.ai/install | bash" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              One command. Sandbox-isolated. Deploys anywhere.
            </div>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-xs text-muted-foreground">
            {metrics.map((m) => (
              <div key={m.label}>
                <div className="text-2xl font-semibold text-foreground">
                  <CountUp to={m.value} suffix={m.suffix} />
                </div>
                {m.label}
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={180} className="relative">
          <div className="animate-float">
            <AttackTerminal />
          </div>
        </Reveal>
      </section>

      {/* Marquee */}
      <section className="relative z-10 border-y border-border/60 bg-surface/40 py-5">
        <div className="overflow-hidden">
          <div className="marquee text-xs uppercase tracking-widest text-muted-foreground">
            {[...attackClasses, ...attackClasses].map((c, i) => {
              const Icon = c.icon;
              return (
                <span key={i} className="inline-flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-primary/70" />
                  {c.label}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Live demo side-by-side: terminal + agent tree */}
      <section id="demo" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-4 py-14 md:px-6 md:py-24">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="outline" className="mb-4">
              <Activity className="h-3 w-3" /> Live, not staged
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Watch a real engagement, in real time
            </h2>
            <p className="mt-3 text-muted-foreground">
              Tool calls stream on the left. Agents spawn on the right. Findings surface as they
              happen — no waiting for a weekly report.
            </p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Reveal>
            <AttackTerminal />
          </Reveal>
          <Reveal delay={120}>
            <AgentTree />
          </Reveal>
        </div>
        <Reveal delay={200}>
          <div className="mt-6">
            <FindingsStream />
          </div>
        </Reveal>
      </section>

      {/* Metrics hero strip */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
        <Reveal>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
            {metrics.map((m) => (
              <div
                key={m.label}
                className="bg-card/80 p-6 text-center backdrop-blur-sm"
              >
                <div className="text-4xl font-semibold tracking-tight text-foreground">
                  <CountUp to={m.value} suffix={m.suffix} />
                </div>
                <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-4 py-12 md:px-6 md:py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="outline" className="mb-4">Platform</Badge>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Everything a security team actually needs
            </h2>
            <p className="mt-3 text-muted-foreground">
              Built for teams that ship — with guardrails, governance and a clean API.
            </p>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.title} delay={i * 60}>
                <div className="group relative h-full overflow-hidden rounded-xl border border-border bg-card/60 p-5 backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow">
                  <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl transition-opacity group-hover:opacity-100" />
                  <div className="relative mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary shadow-[0_0_20px_-4px_hsl(var(--primary)/0.5)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="relative text-base font-semibold">{f.title}</h3>
                  <p className="relative mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-4 py-14 md:px-6 md:py-24">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="outline" className="mb-4">Three steps</Badge>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              From target to report in minutes
            </h2>
          </div>
        </Reveal>
        <div className="relative mt-14 grid gap-6 md:grid-cols-3">
          <div className="pointer-events-none absolute inset-x-[10%] top-12 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block" />
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.num} delay={i * 120}>
                <div className="relative rounded-xl border border-border bg-card/70 p-6 text-center backdrop-blur-sm">
                  <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary shadow-[0_0_30px_-8px_hsl(var(--primary)/0.7)]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="font-mono text-xs tracking-[0.3em] text-muted-foreground">
                    STEP {s.num}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* Security pillars */}
      <section id="security" className="relative z-10 mx-auto max-w-6xl scroll-mt-24 px-4 py-14 md:px-6 md:py-24">
        <Reveal>
          <div className="grid items-start gap-10 md:grid-cols-[1fr_1.1fr]">
            <div>
              <Badge variant="outline" className="mb-4">
                <ShieldCheck className="h-3 w-3" />
                Built for blue-team buyers
              </Badge>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Secure by default, everywhere
              </h2>
              <p className="mt-3 text-muted-foreground">
                Every run lives inside a disposable sandbox. Secrets never leave your tenant.
                Access is role-gated and audit-logged.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  ["Sandbox isolation", "Every tool call runs inside a disposable container with no host credentials."],
                  ["Workspace RBAC", "viewer · analyst · admin roles with SAML / OIDC / Google Workspace SSO."],
                  ["Immutable audit log", "Every action, run view, and finding status change is recorded."],
                  ["Data minimisation", "Configurable retention. Redaction on read. Byte-for-byte exports."],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <div>
                      <div className="font-medium">{t}</div>
                      <div className="text-muted-foreground">{d}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm">
              <div className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-primary/15 blur-3xl" />
              <div className="absolute -right-6 -bottom-6 h-32 w-32 rounded-full bg-fuchsia-500/15 blur-3xl" />
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { icon: Lock, label: "Secrets redacted server-side" },
                  { icon: KeyRound, label: "API keys scoped per role" },
                  { icon: Network, label: "Egress allow-list" },
                  { icon: Users, label: "SAML / OIDC SSO" },
                  { icon: Activity, label: "TPM/RPM throttle guard" },
                  { icon: FileText, label: "SOC 2-ready audit trail" },
                ].map((pill) => {
                  const Icon = pill.icon;
                  return (
                    <div
                      key={pill.label}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 p-3"
                    >
                      <Icon className="h-4 w-4 text-primary" />
                      <span>{pill.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto max-w-5xl px-4 py-12 md:px-6 md:py-20">
        <Reveal>
          <div className="gradient-border relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-fuchsia-500/10 p-6 text-center md:p-10">
            <div className="mx-auto max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Ship a real finding in the next 15 minutes
              </h2>
              <p className="mt-3 text-muted-foreground">
                Start a free trial, plug in your target, and let the agents go to work.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link href="/sign-up">
                  <Button size="lg">
                    Start free trial <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/docs">
                  <Button size="lg" variant="outline">
                    Read the API docs
                  </Button>
                </Link>
              </div>
              <div className="mt-6 flex items-center justify-center">
                <CopyCommand command="curl -sSL https://novahunter.ai/install | bash" />
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border px-4 py-8 text-xs text-muted-foreground md:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <StrixLogo size={20} />
              <span>© {new Date().getFullYear()} {config.appName}</span>
              <span className="hidden md:inline">· Autonomous security agents, on your rails.</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/sign-in" className="hover:text-foreground">Sign in</Link>
              <Link href="/sign-up" className="hover:text-foreground">Sign up</Link>
              <Link href="/docs" className="hover:text-foreground">API</Link>
              <a href="mailto:hello@novahunter.ai" className="hover:text-foreground">
                Contact
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Heart className="h-3 w-3 text-rose-400" />
              <span>Powered by the open-source</span>
              <a
                href={config.upstream.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2/60 px-1.5 py-0.5 font-mono text-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Github className="h-3 w-3" />
                {config.upstream.org}/strix
              </a>
              <span>agent core — all credit to the original authors.</span>
            </div>
            <a
              href={config.upstream.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Star on GitHub <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
