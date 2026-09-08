"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProvider } from "@/lib/api";

export default function McpSettingsPage() {
  const [gallery, setGallery] = useState<Array<{ id: string; name: string; transport: string }>>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    getProvider()
      .listMcpGallery()
      .then((d) => setGallery(d.items ?? []))
      .catch(() => undefined);
  }, []);

  async function addCustom() {
    await getProvider().addCustomMcp({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      url,
      transport: "http+sse",
    });
    setName("");
    setUrl("");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP gallery</CardTitle>
          <CardDescription>Curated MCP servers available to runs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {gallery.map((g) => (
            <div key={g.id} className="text-sm">
              {g.name} ({g.transport})
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add custom MCP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          <Button onClick={addCustom} disabled={!name || !url}>
            Save server
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

