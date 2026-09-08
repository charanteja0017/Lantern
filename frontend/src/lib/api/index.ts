import { config } from "@/lib/config";
import { ApiProvider } from "./api-provider";
import { DemoProvider } from "./demo-provider";
import type { StrixProvider } from "./provider";

let cached: StrixProvider | null = null;

export function getProvider(): StrixProvider {
  if (cached) return cached;
  cached = config.demo ? new DemoProvider() : new ApiProvider(config.apiBaseUrl);
  return cached;
}
