"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProvider } from "@/lib/api";

type ShellTabsProps = { runId: string };

export function ShellTabs({ runId }: ShellTabsProps) {
  const [shellId, setShellId] = useState("default");
  const [knownShells, setKnownShells] = useState<string[]>(["default"]);
  const [command, setCommand] = useState("");
  const [listeners, setListeners] = useState<
    Array<{ listener_id: string; host: string; port: number; clients: number; status: string }>
  >([]);
  const [shellError, setShellError] = useState<string | null>(null);
  const readFailuresRef = useRef(0);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      theme: { background: "#0b1020", foreground: "#d5d9e0" },
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (hostRef.current) {
      term.open(hostRef.current);
      fit.fit();
      term.writeln("NovaHunter terminal attached.");
    }
    termRef.current = term;
    fitRef.current = fit;
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
    };
  }, []);

  const append = (text: string) => {
    const t = termRef.current;
    if (!t) return;
    t.writeln(text.replace(/\r?\n/g, "\r\n"));
  };

  const refreshShells = async () => {
    const res = await getProvider().listShells(runId);
    const names = Object.keys(res.sessions || {});
    setKnownShells(names.length ? names : ["default"]);
    if (names.length && !names.includes(shellId)) setShellId(names[0]);
  };

  useEffect(() => {
    refreshShells().catch(() => undefined);
    getProvider()
      .listListeners(runId)
      .then((r) => setListeners(r.listeners || []))
      .catch(() => undefined);
    const timer = window.setInterval(() => {
      getProvider()
        .readShell(runId, shellId, 0.1)
        .then((res) => {
          readFailuresRef.current = 0;
          setShellError(null);
          const content = String(res.content || "").trim();
          if (content) append(content);
        })
        .catch((err) => {
          readFailuresRef.current += 1;
          if (readFailuresRef.current === 1) {
            const msg = err instanceof Error ? err.message : "Shell read failed";
            setShellError(msg);
          }
        });
      getProvider()
        .listListeners(runId)
        .then((r) => setListeners(r.listeners || []))
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [runId, shellId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <TerminalIcon className="h-4 w-4" /> Terminals
        </CardTitle>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={shellId}
            onChange={(e) => setShellId(e.target.value)}
          >
            {knownShells.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const id = `shell-${Date.now().toString().slice(-4)}`;
              await getProvider().spawnShell(runId, id);
              setKnownShells((prev) => [...new Set([...prev, id])]);
              setShellId(id);
              append(`[spawned ${id}]`);
            }}
          >
            New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {shellError ? (
          <div className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Terminal polling degraded: {shellError}
          </div>
        ) : null}
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Listeners
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await getProvider().createListener(runId);
                const r = await getProvider().listListeners(runId);
                setListeners(r.listeners || []);
              }}
            >
              New listener
            </Button>
          </div>
          <div className="space-y-1 text-xs">
            {listeners.length === 0 ? (
              <div className="text-muted-foreground">No listeners yet.</div>
            ) : (
              listeners.map((l) => (
                <div key={l.listener_id} className="flex items-center justify-between rounded border border-border px-2 py-1">
                  <span className="font-mono">
                    {l.listener_id} — {l.host}:{l.port} ({l.clients} clients)
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await getProvider().closeListener(runId, l.listener_id);
                      const r = await getProvider().listListeners(runId);
                      setListeners(r.listeners || []);
                    }}
                  >
                    Close
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
        <div ref={hostRef} className="h-72 w-full overflow-hidden rounded-md border border-border" />
        <div className="flex items-center gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Type command..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== "Enter") return;
              const cmd = command.trim();
              if (!cmd) return;
              setCommand("");
              append(`$ ${cmd}`);
              try {
                const res = await getProvider().writeShell(runId, shellId, cmd);
                const out = String(res.content || "").trim();
                if (out) append(out);
              } catch (err) {
                const msg = err instanceof Error ? err.message : "Command failed";
                toast.error(msg);
                append(`[error] ${msg}`);
              }
            }}
          />
          <Button
            size="sm"
            onClick={async () => {
              const cmd = command.trim();
              if (!cmd) return;
              setCommand("");
              append(`$ ${cmd}`);
              try {
                const res = await getProvider().writeShell(runId, shellId, cmd);
                const out = String(res.content || "").trim();
                if (out) append(out);
              } catch (err) {
                const msg = err instanceof Error ? err.message : "Command failed";
                toast.error(msg);
                append(`[error] ${msg}`);
              }
            }}
          >
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

