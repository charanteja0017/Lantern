"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Lock, Play, ShieldAlert, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadAuth, subscribeAuth, DEFAULT_AUTH, type DocsAuth } from "./docs-auth";
import type { Endpoint } from "./endpoints";

type Result = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: string;
  url: string;
  error?: string;
  offline?: boolean;
};

export function TryIt({ endpoint }: { endpoint: Endpoint }) {
  const [auth, setAuth] = useState<DocsAuth>(DEFAULT_AUTH);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(endpoint));
  const [body, setBody] = useState(endpoint.requestBodyExample ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    setAuth(loadAuth());
    return subscribeAuth(() => setAuth(loadAuth()));
  }, []);

  useEffect(() => {
    setValues(initialValues(endpoint));
    setBody(endpoint.requestBodyExample ?? "");
    setResult(null);
  }, [endpoint.id]);

  const pathParams = (endpoint.params ?? []).filter((p) => p.in === "path");
  const queryParams = (endpoint.params ?? []).filter((p) => p.in === "query");
  const headerParams = (endpoint.params ?? []).filter((p) => p.in === "header");
  const hasBody = Boolean(endpoint.requestBodyExample);
  const isSse = endpoint.path.endsWith("/events");

  const builtUrl = useMemo(() => {
    const base = auth.baseUrl || DEFAULT_AUTH.baseUrl;
    let path = endpoint.path.replace(/^\/v1/, "");
    for (const p of pathParams) {
      const v = values[p.name] ?? `{${p.name}}`;
      path = path.replaceAll(`{${p.name}}`, encodeURIComponent(v || `{${p.name}}`));
    }
    const qs = new URLSearchParams();
    for (const p of queryParams) {
      const v = values[p.name];
      if (v && v.length > 0) qs.set(p.name, v);
    }
    const qsStr = qs.toString();
    return `${base.replace(/\/$/, "")}${path}${qsStr ? `?${qsStr}` : ""}`;
  }, [endpoint, values, auth.baseUrl, pathParams, queryParams]);

  const canSend = auth.authorized && !isSse && pathParams.every((p) => values[p.name]?.length);

  const onSend = async () => {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    const started = performance.now();
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${auth.apiKey}`,
        Accept: "application/json",
      };
      for (const h of headerParams) {
        const v = values[h.name];
        if (v) headers[h.name] = v;
      }
      if (endpoint.method === "POST" && hasBody) headers["Content-Type"] = "application/json";

      const res = await fetch(builtUrl, {
        method: endpoint.method,
        headers,
        body: endpoint.method === "POST" && hasBody ? body : undefined,
      });

      const duration = Math.round(performance.now() - started);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      let text = "";
      try {
        text = await res.text();
        if (resHeaders["content-type"]?.includes("json") && text) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            /* keep raw */
          }
        }
      } catch {
        text = "";
      }
      setResult({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        durationMs: duration,
        headers: resHeaders,
        body: text,
        url: builtUrl,
      });
    } catch (e) {
      const duration = Math.round(performance.now() - started);
      setResult({
        ok: false,
        status: 0,
        statusText: "Network error",
        durationMs: duration,
        headers: {},
        body: endpoint.responseExample,
        url: builtUrl,
        error: e instanceof Error ? e.message : String(e),
        offline: true,
      });
    } finally {
      setSending(false);
    }
  };

  if (isSse) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <div className="mb-1 flex items-center gap-2 font-medium">
          <Zap className="h-4 w-4" />
          Streams can&apos;t be tested from the browser
        </div>
        Use <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">curl -N</code>{" "}
        or an SSE client in your own environment. See the cURL snippet above.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!auth.authorized ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1">
            Authorize with your API key to enable the playground. Your key is stored locally only.
          </div>
        </div>
      ) : null}

      {/* URL preview */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-[#0b1020] px-3 py-2 font-mono text-[12px]">
        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
          {endpoint.method}
        </span>
        <code className="flex-1 truncate text-foreground/90" title={builtUrl}>
          {builtUrl}
        </code>
        <CopyInline text={builtUrl} />
      </div>

      {/* Inputs */}
      {pathParams.length > 0 && (
        <ParamGroup title="Path parameters">
          {pathParams.map((p) => (
            <ParamInput
              key={p.name}
              name={p.name}
              type={p.type}
              required={p.required}
              placeholder={p.example ?? `{${p.name}}`}
              value={values[p.name] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
              description={p.description}
            />
          ))}
        </ParamGroup>
      )}

      {queryParams.length > 0 && (
        <ParamGroup title="Query parameters">
          {queryParams.map((p) => (
            <ParamInput
              key={p.name}
              name={p.name}
              type={p.type}
              placeholder={p.example ?? p.default ?? ""}
              value={values[p.name] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
              description={p.description}
            />
          ))}
        </ParamGroup>
      )}

      {headerParams.length > 0 && (
        <ParamGroup title="Headers">
          {headerParams.map((p) => (
            <ParamInput
              key={p.name}
              name={p.name}
              type={p.type}
              placeholder={p.example ?? ""}
              value={values[p.name] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
              description={p.description}
            />
          ))}
        </ParamGroup>
      )}

      {hasBody && (
        <div>
          <Label className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Request body
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal">
              application/json
            </span>
          </Label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="h-40 w-full rounded-md border border-border bg-[#0b1020] px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground outline-none transition-colors focus:border-primary/40"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSend} disabled={!canSend || sending}>
          <Play className="mr-1.5 h-3.5 w-3.5" />
          {sending ? "Sending…" : "Send request"}
        </Button>
        {!auth.authorized ? (
          <span className="text-xs text-muted-foreground">
            <Link href="#" onClick={(e) => e.preventDefault()} className="text-primary hover:underline">
              Click Authorize at the top
            </Link>{" "}
            to enable sending.
          </span>
        ) : null}
      </div>

      {/* Response */}
      {result && <ResponsePanel result={result} />}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function initialValues(endpoint: Endpoint): Record<string, string> {
  const v: Record<string, string> = {};
  for (const p of endpoint.params ?? []) {
    if (p.example) v[p.name] = p.example;
    else if (p.default) v[p.name] = p.default;
  }
  return v;
}

function ParamGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ParamInput({
  name,
  type,
  required,
  placeholder,
  value,
  onChange,
  description,
}: {
  name: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  description?: string;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-3 gap-y-1 md:grid-cols-[220px_1fr]">
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="font-mono text-[13px] font-medium">{name}</code>
          <span className="rounded bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {type}
          </span>
          {required && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-300">
              required
            </span>
          )}
        </div>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="font-mono text-sm"
      />
    </div>
  );
}

function ResponsePanel({ result }: { result: Result }) {
  const color =
    result.status === 0
      ? "text-red-400 bg-red-500/15 border-red-500/40"
      : result.ok
        ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/40"
        : result.status >= 400 && result.status < 500
          ? "text-amber-300 bg-amber-500/15 border-amber-500/40"
          : "text-red-400 bg-red-500/15 border-red-500/40";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] ${color}`}>
          {result.status === 0 ? "—" : result.status} {result.statusText}
        </span>
        <span className="text-muted-foreground">
          {result.durationMs} ms
        </span>
        {result.offline ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
            <AlertTriangle className="h-3 w-3" />
            network / CORS — sample shown
          </span>
        ) : null}
      </div>

      {result.error ? (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Request failed</div>
            <div className="mt-0.5 font-mono text-red-300/80">{result.error}</div>
            <div className="mt-1 text-red-200/70">
              This typically means CORS is not allowed on the target origin, or the base URL is not
              reachable from this browser. Run the cURL snippet from your terminal instead.
            </div>
          </div>
        </div>
      ) : null}

      {Object.keys(result.headers).length > 0 && (
        <details className="mb-2 rounded-md border border-border bg-[#0b1020] text-xs">
          <summary className="cursor-pointer list-none px-3 py-1.5 text-muted-foreground hover:text-foreground">
            Response headers ({Object.keys(result.headers).length})
          </summary>
          <pre className="overflow-x-auto px-3 pb-3 font-mono text-[11px] text-foreground/80">
            {Object.entries(result.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
          </pre>
        </details>
      )}

      <div className="overflow-hidden rounded-md border border-border bg-[#0b1020]">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Response body</span>
          <CopyInline text={result.body} small />
        </div>
        <pre className="max-h-[420px] overflow-auto px-3 py-3 font-mono text-[12px] leading-relaxed text-foreground/90 scrollbar-thin">
          <code>{result.body || "(empty)"}</code>
        </pre>
      </div>
    </div>
  );
}

function CopyInline({ text, small }: { text: string; small?: boolean }) {
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
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground ${
        small ? "text-[10px]" : "text-[11px]"
      }`}
      aria-label={copied ? "Copied" : "Copy"}
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
  );
}
