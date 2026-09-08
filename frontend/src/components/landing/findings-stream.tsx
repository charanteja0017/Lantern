"use client";

import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, Bug, ShieldAlert, Skull } from "lucide-react";

type Sev = "critical" | "high" | "medium" | "low";

type Item = { id: string; title: string; target: string; sev: Sev; at: number };

const POOL: Omit<Item, "at" | "id">[] = [
  { title: "IDOR in /api/users/{id}", target: "api.acme.com", sev: "high" },
  { title: "Reflected XSS in /search?q=", target: "www.acme.com", sev: "medium" },
  { title: "SQL injection in /auth/login", target: "api.acme.com", sev: "critical" },
  { title: "Hardcoded AWS key in main.js", target: "www.acme.com", sev: "critical" },
  { title: "Open redirect on /out?url=", target: "www.acme.com", sev: "low" },
  { title: "Server-Side Request Forgery in /proxy", target: "api.acme.com", sev: "high" },
  { title: "JWT algorithm confusion (alg=none)", target: "api.acme.com", sev: "high" },
  { title: "Broken access control on /admin/users", target: "admin.acme.com", sev: "critical" },
  { title: "CSRF on password change", target: "www.acme.com", sev: "medium" },
  { title: "Path traversal in /files?name=", target: "api.acme.com", sev: "medium" },
];

const ICON: Record<Sev, React.ComponentType<{ className?: string }>> = {
  critical: Skull,
  high: AlertOctagon,
  medium: AlertTriangle,
  low: ShieldAlert,
};

const STYLE: Record<Sev, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-300",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  low: "border-sky-400/30 bg-sky-400/10 text-sky-300",
};

export function FindingsStream() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let n = 0;
    const tick = () => {
      const pick = POOL[Math.floor(Math.random() * POOL.length)];
      n += 1;
      setItems((prev) =>
        [
          { id: `f-${Date.now()}-${n}`, at: Date.now(), ...pick },
          ...prev,
        ].slice(0, 7),
      );
    };
    tick();
    const id = window.setInterval(tick, 1800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-lg">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Findings stream</span>
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
            live
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">auto-refreshing</span>
      </div>
      <ul className="space-y-2">
        {items.map((item, idx) => {
          const Icon = ICON[item.sev];
          return (
            <li
              key={item.id}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${
                idx === 0 ? "fade-up in" : ""
              } ${STYLE[item.sev]}`}
            >
              <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{item.title}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{item.target}</span>
                  <span>·</span>
                  <span className="uppercase">{item.sev}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
