import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: config.appName,
    mode: config.demo ? "demo" : "live",
    apiConfigured: Boolean(config.apiBaseUrl),
    time: new Date().toISOString(),
  });
}
