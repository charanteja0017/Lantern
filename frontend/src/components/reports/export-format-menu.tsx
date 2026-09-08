"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getProvider } from "@/lib/api";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/api/provider";

interface ExportFormatMenuProps {
  runId: string;
  runName?: string;
  variant?: "outline" | "default" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
  /**
   * When provided, the primary click exports in this format and the rest
   * live in the dropdown. Defaults to "pdf".
   */
  primaryFormat?: ExportFormat;
  className?: string;
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Dropdown menu that requests the server-rendered report in the selected
 * format and triggers a browser download. This replaces the client-side
 * jsPDF generator that shipped in earlier iterations — the PDF, Markdown,
 * HTML, JSON, SARIF, and CSV all come from the same backend artifact, so
 * whatever is downloaded matches what the API serves byte-for-byte.
 */
export function ExportFormatMenu({
  runId,
  runName,
  variant = "outline",
  size = "sm",
  disabled,
  primaryFormat = "pdf",
  className,
}: ExportFormatMenuProps) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  async function runExport(fmt: ExportFormat) {
    setExporting(fmt);
    try {
      const { blob, filename } = await getProvider().exportRun(runId, fmt);
      triggerDownload(filename, blob);
      toast.success(
        `${fmt.toUpperCase()} report downloaded${runName ? ` for ${runName}` : ""}.`,
      );
    } catch (err) {
      console.error("export failed", err);
      const msg =
        err instanceof Error && err.message
          ? err.message
          : `Could not generate the ${fmt.toUpperCase()} report.`;
      toast.error(msg);
    } finally {
      setExporting(null);
    }
  }

  const busy = exporting !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size={size}
          variant={variant}
          disabled={disabled || busy}
          title="Export report"
          className={className}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 h-3.5 w-3.5" />
          )}
          {busy ? `${exporting?.toUpperCase()}…` : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Export format</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EXPORT_FORMATS.map((f) => (
          <DropdownMenuItem
            key={f.value}
            onSelect={(e) => {
              e.preventDefault();
              void runExport(f.value);
            }}
            disabled={busy}
          >
            <div className="flex w-full flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                {f.label}
                {f.value === primaryFormat ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                    Default
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{f.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
