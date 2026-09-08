"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/layout/shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/common/severity-badge";
import { PageError, PageLoading } from "@/components/common/page-state";
import { useProviderData } from "@/lib/api/use-provider-data";
import { getProvider } from "@/lib/api/provider-context";

export default function FindingDetailPage() {
  const params = useParams<{ findingId: string }>();
  const findingId = params?.findingId ?? "";

  const { data: finding, loading, error, refetch } = useProviderData(
    (p) => p.getFinding(findingId),
    [findingId],
    // Finding details mutate as the agent continues investigating (evidence
    // gets appended, severity can be adjusted). 10s keeps us fresh without
    // being noisy.
    { pollMs: 10000 },
  );
  const [triageStatus, setTriageStatus] = useState<string>("confirmed");
  const [triageNote, setTriageNote] = useState<string>("");
  const [triageBusy, setTriageBusy] = useState(false);

  if (loading) return <PageLoading label="Loading finding…" />;

  if (error) {
    // Treat explicit 404s from the backend as proper not-found pages, but
    // keep transient failures (500, network) recoverable via retry.
    if (/not.?found|404/i.test(error.message)) notFound();
    return <PageError error={error} onRetry={refetch} />;
  }

  if (!finding) notFound();

  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/findings" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to findings
        </Link>
      </div>
      <PageHeader
        title={finding.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            {finding.cvss ? <Badge variant="outline">CVSS {finding.cvss}</Badge> : null}
            {finding.cwe ? <Badge variant="outline">{finding.cwe}</Badge> : null}
            {finding.cve ? <Badge variant="outline">{finding.cve}</Badge> : null}
            {finding.target ? <Badge variant="default">{finding.target}</Badge> : null}
            {finding.endpoint ? (
              <Badge variant="default">
                {finding.method ?? "GET"} {finding.endpoint}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={triageBusy}
              onClick={async () => {
                setTriageBusy(true);
                try {
                  await getProvider().retestFinding(finding.id);
                } finally {
                  setTriageBusy(false);
                }
              }}
            >
              Retest <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm">
              Export PDF <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-invert max-w-none text-sm">
              <p className="whitespace-pre-wrap">{finding.description}</p>
            </CardContent>
          </Card>

          {finding.impact ? (
            <Card>
              <CardHeader>
                <CardTitle>Impact</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="whitespace-pre-wrap">{finding.impact}</p>
              </CardContent>
            </Card>
          ) : null}

          {finding.technicalAnalysis ? (
            <Card>
              <CardHeader>
                <CardTitle>Technical analysis</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="whitespace-pre-wrap">{finding.technicalAnalysis}</p>
              </CardContent>
            </Card>
          ) : null}

          {finding.pocScript ? (
            <Card>
              <CardHeader>
                <CardTitle>Proof of concept</CardTitle>
                {finding.pocDescription ? (
                  <CardDescription>{finding.pocDescription}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-3 font-mono text-xs">
                  {finding.pocScript}
                </pre>
              </CardContent>
            </Card>
          ) : null}

          {finding.codeLocations?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Affected code locations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {finding.codeLocations.map((loc, i) => (
                  <div key={i} className="rounded-md border border-border bg-surface/60 p-3">
                    <div className="font-mono text-xs text-muted-foreground">
                      {loc.file}
                      {loc.startLine ? `:${loc.startLine}` : ""}
                      {loc.endLine ? `-${loc.endLine}` : ""}
                    </div>
                    {loc.snippet ? (
                      <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
                        {loc.snippet}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Remediation</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="whitespace-pre-wrap">{finding.remediation ?? "—"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div>Status: {finding.status ?? "open"}</div>
              <div>
                ID: <span className="font-mono">{finding.id}</span>
              </div>
              <div>Detected: {new Date(finding.timestamp).toLocaleString()}</div>
              {finding.cvss ? <div>CVSS: {finding.cvss}</div> : null}
              {finding.cwe ? <div>CWE: {finding.cwe}</div> : null}
              {finding.cve ? <div>CVE: {finding.cve}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Triage</CardTitle>
              <CardDescription>Update lifecycle status with an audit note.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={triageStatus}
                onChange={(e) => setTriageStatus(e.target.value)}
              >
                {["open", "confirmed", "false_positive", "accepted_risk", "remediated", "retested_closed"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <textarea
                className="min-h-20 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                placeholder="Transition note"
                value={triageNote}
                onChange={(e) => setTriageNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={triageBusy}
                onClick={async () => {
                  setTriageBusy(true);
                  try {
                    await getProvider().triageFinding(
                      finding.id,
                      triageStatus as
                        | "open"
                        | "confirmed"
                        | "false_positive"
                        | "accepted_risk"
                        | "remediated"
                        | "retested_closed",
                      triageNote,
                    );
                    await refetch();
                  } finally {
                    setTriageBusy(false);
                  }
                }}
              >
                Save triage
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
