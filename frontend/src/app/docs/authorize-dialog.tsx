"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Lock, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearAuth, DEFAULT_AUTH, loadAuth, maskKey, saveAuth, subscribeAuth } from "./docs-auth";

export function AuthorizeButton() {
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState(DEFAULT_AUTH);

  useEffect(() => {
    setAuth(loadAuth());
    return subscribeAuth(() => setAuth(loadAuth()));
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${
            auth.authorized
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
              : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          }`}
        >
          {auth.authorized ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Authorized</span>
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                {maskKey(auth.apiKey)}
              </span>
            </>
          ) : (
            <>
              <Lock className="h-3.5 w-3.5" />
              Authorize
            </>
          )}
        </button>
      </DialogTrigger>
      <AuthorizeDialogContent onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function AuthorizeDialogContent({ onDone }: { onDone: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_AUTH.baseUrl);
  const [showKey, setShowKey] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const a = loadAuth();
    setApiKey(a.apiKey);
    setBaseUrl(a.baseUrl);
    setAuthorized(a.authorized);
  }, []);

  const onAuthorize = () => {
    if (!apiKey.trim()) return;
    saveAuth({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || DEFAULT_AUTH.baseUrl, authorized: true });
    setAuthorized(true);
    onDone();
  };

  const onLogout = () => {
    clearAuth();
    setApiKey("");
    setAuthorized(false);
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          Authorize
        </DialogTitle>
        <DialogDescription>
          Store your API key locally to test endpoints in the playground. Your key never leaves this
          browser.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-md border border-border bg-surface-2/50 p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            How it is used
          </div>
          The key is sent only when you click <kbd className="rounded bg-surface px-1 py-0.5 font-mono text-[10px]">Send</kbd>.
          It is stored in <code className="rounded bg-surface px-1 py-0.5 font-mono text-[10px]">localStorage</code>{" "}
          and never transmitted to NovaHunter servers.
        </div>

        <div className="space-y-2">
          <Label htmlFor="docs-api-key">API key</Label>
          <div className="relative">
            <Input
              id="docs-api-key"
              type={showKey ? "text" : "password"}
              placeholder="novahunter_live_sk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-10 font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-surface-2/60 hover:text-foreground"
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Create one in{" "}
            <Link href="/profile?tab=api-keys" className="text-primary hover:underline">
              Profile → API keys
            </Link>
            .
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="docs-base-url">Base URL</Label>
          <Input
            id="docs-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.novahunter.ai/v1"
            className="font-mono text-sm"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Override this if you deploy the backend to your own VPS or domain.
          </p>
        </div>
      </div>

      <DialogFooter className="gap-2">
        {authorized ? (
          <Button variant="outline" onClick={onLogout} className="mr-auto text-destructive">
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Sign out
          </Button>
        ) : null}
        <Button onClick={onAuthorize} disabled={!apiKey.trim()}>
          <Check className="mr-1 h-4 w-4" />
          {authorized ? "Update" : "Authorize"}
        </Button>
      </DialogFooter>

      <div className="mt-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <Link href="/profile?tab=api-keys" className="inline-flex items-center gap-1 hover:text-foreground">
          Manage API keys <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </DialogContent>
  );
}
