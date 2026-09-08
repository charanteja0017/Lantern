import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,hsl(var(--surface-2))_0%,hsl(var(--surface))_50%,hsl(var(--surface-2))_100%)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}
