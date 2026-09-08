import Link from "next/link";
import { ArrowLeft, Compass, Home } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StrixLogo } from "@/components/common/logo";
import { config } from "@/lib/config";

export const metadata = {
  title: "404 — Lost in space",
};

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      {/* Aurora backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-1/2 h-[700px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,hsl(190_95%_55%/0.28),transparent_70%)] blur-3xl motion-safe:animate-[aurora-drift_14s_ease-in-out_infinite]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-1/3 right-0 h-[600px] w-[700px] rounded-full bg-[radial-gradient(closest-side,hsl(280_80%_60%/0.24),transparent_70%)] blur-3xl motion-safe:animate-[aurora-drift-reverse_18s_ease-in-out_infinite]"
      />

      {/* Grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(hsl(210_40%_98%)_1px,transparent_1px),linear-gradient(90deg,hsl(210_40%_98%)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]"
      />

      {/* Floating orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[12%] top-[20%] h-2 w-2 rounded-full bg-primary shadow-[0_0_20px_6px_hsl(190_95%_55%/0.6)] motion-safe:animate-[float_6s_ease-in-out_infinite]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[18%] top-[30%] h-1.5 w-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_16px_4px_hsl(300_80%_60%/0.5)] motion-safe:animate-[float_8s_ease-in-out_infinite_-2s]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[22%] left-[22%] h-1 w-1 rounded-full bg-cyan-300 shadow-[0_0_14px_4px_hsl(190_95%_70%/0.5)] motion-safe:animate-[float_7s_ease-in-out_infinite_-1s]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[30%] right-[28%] h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_18px_6px_hsl(260_80%_65%/0.5)] motion-safe:animate-[float_9s_ease-in-out_infinite_-3s]"
      />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center px-6 text-center">
        <Link
          href="/dashboard"
          className="mb-10 inline-flex items-center gap-2 opacity-90 transition-opacity hover:opacity-100"
        >
          <StrixLogo size={28} />
          <span className="text-sm font-semibold tracking-tight">{config.appName}</span>
        </Link>

        {/* The big 404 */}
        <div className="relative">
          <h1
            aria-label="404"
            className="select-none bg-gradient-to-b from-foreground via-foreground to-muted-foreground/40 bg-clip-text font-mono text-[10rem] font-extrabold leading-none tracking-tighter text-transparent drop-shadow-[0_10px_40px_hsl(190_95%_55%/0.2)] sm:text-[14rem] motion-safe:animate-[fade-rise_0.9s_ease-out_forwards]"
          >
            404
          </h1>
          {/* Glitch layers (sit on top, pointer-events-none so don't block) */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none bg-clip-text font-mono text-[10rem] font-extrabold leading-none tracking-tighter text-transparent sm:text-[14rem] motion-safe:animate-[glitch-a_4s_steps(12,end)_infinite]"
            style={{
              backgroundImage:
                "linear-gradient(hsl(190 95% 55%), hsl(190 95% 55%))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              mixBlendMode: "screen",
              opacity: 0.55,
            }}
          >
            404
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none bg-clip-text font-mono text-[10rem] font-extrabold leading-none tracking-tighter text-transparent sm:text-[14rem] motion-safe:animate-[glitch-b_4s_steps(12,end)_infinite]"
            style={{
              backgroundImage:
                "linear-gradient(hsl(315 85% 60%), hsl(315 85% 60%))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              mixBlendMode: "screen",
              opacity: 0.45,
            }}
          >
            404
          </span>
        </div>

        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface/50 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm motion-safe:animate-[fade-rise_0.9s_ease-out_0.15s_both]">
          <Compass className="h-3.5 w-3.5 text-primary motion-safe:animate-[spin_8s_linear_infinite]" />
          Page not found
        </div>

        <h2 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl motion-safe:animate-[fade-rise_0.9s_ease-out_0.25s_both]">
          You&apos;ve wandered off the map.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base motion-safe:animate-[fade-rise_0.9s_ease-out_0.35s_both]">
          The page you were looking for doesn&apos;t exist, moved somewhere else,
          or never had a door to begin with. Let&apos;s get you back to known
          territory.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row motion-safe:animate-[fade-rise_0.9s_ease-out_0.45s_both]">
          <Button asChild size="lg" className="group gap-2">
            <Link href="/dashboard">
              <Home className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="group gap-2">
            <Link href="/runs">
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              View active runs
            </Link>
          </Button>
        </div>

        <p className="mt-12 font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground/70 motion-safe:animate-[fade-rise_0.9s_ease-out_0.6s_both]">
          ERR_PATH_NOT_FOUND · {config.appName}
        </p>
      </div>
    </div>
  );
}
