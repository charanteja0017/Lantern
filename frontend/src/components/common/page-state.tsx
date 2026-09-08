"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

export function PageError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  const message = error.message || "Something went wrong.";
  const unauthorized = /401|unauthori[sz]ed/i.test(message);
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <div className="inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {unauthorized ? "Unauthorized" : "Failed to load"}
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
