"use client";

import { useState } from "react";
import { Send, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getProvider } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

export function ChatPanel({
  runId,
  agentId,
  agentName,
  messages,
  onUserMessage,
  onStopAgent,
}: {
  runId: string;
  agentId: string;
  agentName: string;
  messages: ChatMessage[];
  onUserMessage: (content: string) => void;
  onStopAgent: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const agentMessages = messages.filter((m) => m.agentId === agentId || m.role === "system");

  async function send() {
    const content = value.trim();
    if (!content) return;
    setPending(true);
    try {
      await getProvider().sendAgentMessage(runId, agentId, content);
      onUserMessage(content);
      setValue("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function stop() {
    try {
      await getProvider().stopAgent(runId, agentId);
      onStopAgent();
      toast.success(`${agentName} stopped`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback>{agentName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm font-medium">{agentName}</div>
            <div className="text-[11px] text-muted-foreground">Agent conversation</div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={stop}>
          <Square className="h-3.5 w-3.5" /> Stop
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
        {agentMessages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
        {agentMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet for this agent.
          </div>
        ) : null}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Message ${agentName}…`}
        />
        <Button type="submit" disabled={pending || !value.trim()}>
          <Send className="h-4 w-4" /> Send
        </Button>
      </form>
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  return (
    <div className={cn("flex flex-col gap-1", isUser && "items-end")}>
      <div
        className={cn(
          "rounded-lg border p-3 text-sm",
          isUser
            ? "max-w-[80%] border-primary/30 bg-primary/10 text-foreground"
            : isTool
              ? "max-w-[90%] border-border bg-surface-2/60 font-mono text-xs"
              : "max-w-[90%] border-border bg-surface/60",
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant={isUser ? "primary" : isTool ? "default" : "outline"} className="uppercase">
            {message.role}
          </Badge>
          <span>{formatRelativeTime(message.timestamp)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}
