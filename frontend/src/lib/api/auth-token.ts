// Small singleton bridge that lets non-React code (the ApiProvider fetch
// helper) obtain the current Clerk session JWT without importing React.
//
// `<ClerkTokenBridge />` (client component) registers a getter on mount
// once Clerk has hydrated the session; any subsequent `getAuthToken()`
// call returns the live token or null.
//
// A "ready" promise lets `getAuthToken()` block briefly while Clerk
// finishes loading — otherwise the first page-level fetch (which races
// Clerk's hydration effect) would go out without an Authorization header
// and the backend would 401 us.

type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;
let readyResolve: (() => void) | null = null;
let ready: Promise<void> = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

function resetReady(): void {
  ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
}

export function setAuthTokenGetter(fn: TokenGetter | null): void {
  getter = fn;
  if (fn) {
    // Release any pending `getAuthToken()` callers immediately.
    readyResolve?.();
    readyResolve = null;
  } else {
    // Cleared on unmount — re-arm for the next mount so late callers block.
    resetReady();
  }
}

/**
 * Return the current Clerk session JWT, waiting up to `timeoutMs` for the
 * ClerkTokenBridge to register its getter. Resolves with `null` when Clerk
 * isn't configured (demo mode) or when the wait times out.
 */
export async function getAuthToken(timeoutMs = 3000): Promise<string | null> {
  if (!getter) {
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }
  if (!getter) return null;
  try {
    return await getter();
  } catch {
    return null;
  }
}
