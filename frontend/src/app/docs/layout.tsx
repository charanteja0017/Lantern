import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference",
  description: "Official REST API documentation for the NovaHunter security platform.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
