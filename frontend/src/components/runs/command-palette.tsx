"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function parseSlashCommand(input: string): { command: string; args: string[] } | null {
  const text = input.trim();
  if (!text.startsWith("/")) return null;
  const parts = text.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
}

export function CommandPalette({
  onCommand,
}: {
  onCommand: (parsed: { command: string; args: string[] }) => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = parseSlashCommand(value);
    if (!parsed) return;
    setBusy(true);
    try {
      await onCommand(parsed);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="/pause, /resume, /restart, /kill, /budget 2.5"
      />
      <Button size="sm" variant="outline" onClick={submit} disabled={busy}>
        Run
      </Button>
    </div>
  );
}

