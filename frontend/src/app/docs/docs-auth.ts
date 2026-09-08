"use client";

import { config } from "@/lib/config";

const STORAGE_KEY = "novahunter.docs.auth.v1";
const DEFAULT_BASE = `${config.apiHost}/v1`;

export type DocsAuth = {
  apiKey: string;
  baseUrl: string;
  authorized: boolean;
};

export const DEFAULT_AUTH: DocsAuth = {
  apiKey: "",
  baseUrl: DEFAULT_BASE,
  authorized: false,
};

export function loadAuth(): DocsAuth {
  if (typeof window === "undefined") return DEFAULT_AUTH;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTH;
    const parsed = JSON.parse(raw) as DocsAuth;
    return {
      apiKey: parsed.apiKey || "",
      baseUrl: parsed.baseUrl || DEFAULT_BASE,
      authorized: Boolean(parsed.authorized && parsed.apiKey),
    };
  } catch {
    return DEFAULT_AUTH;
  }
}

export function saveAuth(auth: DocsAuth): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  window.dispatchEvent(new CustomEvent("novahunter:docs-auth"));
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("novahunter:docs-auth"));
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return `${key.slice(0, 3)}••••`;
  return `${key.slice(0, 7)}••••••••${key.slice(-4)}`;
}

export function subscribeAuth(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener("novahunter:docs-auth", handler);
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) listener();
  });
  return () => {
    window.removeEventListener("novahunter:docs-auth", handler);
  };
}
