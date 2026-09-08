import { cn } from "@/lib/utils";

export function StrixLogo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
        <defs>
          <linearGradient id="strix-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(190 95% 60%)" />
            <stop offset="100%" stopColor="hsl(230 95% 60%)" />
          </linearGradient>
        </defs>
        <path
          d="M20 3 L35 12 V28 L20 37 L5 28 V12 Z"
          fill="url(#strix-g)"
          opacity="0.16"
          stroke="url(#strix-g)"
          strokeWidth="1.5"
        />
        <path
          d="M14 14 H26 M14 20 H22 M14 26 H26"
          stroke="url(#strix-g)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
