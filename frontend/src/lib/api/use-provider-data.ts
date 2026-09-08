"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { StrixProvider } from "./provider";
import { getProvider } from "./index";

type FetcherFn<T> = (provider: StrixProvider) => Promise<T>;

export type ProviderDataState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** Reload now; shows the loading spinner. */
  refetch: () => void;
  /** Reload now without flipping `loading` — used for background refresh. */
  silentRefetch: () => void;
};

export type UseProviderDataOptions = {
  /**
   * When set, the fetcher is re-invoked on this interval without flipping
   * ``loading`` — so the UI updates silently in place. Set to ``0`` / omitted
   * to disable. The timer is paused while the tab is hidden (via the
   * Page Visibility API) and kicked once when the tab becomes visible again,
   * which avoids wasted network when the dashboard sits in a background tab.
   */
  pollMs?: number;
  /**
   * When true, the polling timer will keep running even when the tab is
   * hidden. Defaults to false. Leave it false for almost every UI — this is
   * mostly useful for dashboards that must stay current even off-screen.
   */
  pollInBackground?: boolean;
};

/**
 * Client-side data fetching hook that runs in `useEffect`, so relative
 * API paths, credentials and Clerk's session JWT (via the ApiProvider
 * auth-token bridge) all resolve correctly in the browser.
 *
 * Use this in place of top-level `await` in Server Components whenever a
 * page depends on the authenticated backend — Server Components can't
 * carry the user's Clerk session or set `credentials: "include"` cookies.
 *
 * Pass ``options.pollMs`` to enable silent background refresh — e.g. 5000
 * on the runs list so new runs, status transitions and live stat updates
 * appear without the user clicking "Refresh". Intervals pause while the
 * tab is hidden (Page Visibility API) to avoid wasted requests.
 */
export function useProviderData<T>(
  fetcher: FetcherFn<T>,
  deps: readonly unknown[] = [],
  options: UseProviderDataOptions = {},
): ProviderDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [nonce, setNonce] = useState(0);
  const [silentNonce, setSilentNonce] = useState(0);

  // Keep the latest fetcher in a ref so we don't need to include it in the
  // dep array (callers pass inline functions which would churn the effect).
  // useLayoutEffect runs synchronously before the fetch effect below, so we
  // always see the latest closure without mutating `.current` during render.
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  // Track whether the most recent in-flight request was triggered silently
  // (polling or silentRefetch) so we don't clobber ``loading`` below.
  const silentRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const silent = silentRef.current;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    fetcherRef
      .current(getProvider())
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // On silent refreshes we don't want a transient blip (e.g. network
        // hiccup, Clerk token rotating) to blow away a perfectly good render.
        // Swallow and log instead; the next tick will recover.
        if (silent) {
          // eslint-disable-next-line no-console
          console.warn("useProviderData: silent refresh failed", err);
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (cancelled) return;
        silentRef.current = false;
        if (!silent) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, silentNonce, ...deps]);

  const refetch = useCallback(() => {
    silentRef.current = false;
    setNonce((n) => n + 1);
  }, []);
  const silentRefetch = useCallback(() => {
    silentRef.current = true;
    setSilentNonce((n) => n + 1);
  }, []);

  // Background polling. Pauses automatically when the tab is hidden; kicks
  // one extra refresh the moment it comes back into focus so stale data is
  // replaced immediately, not at the next tick.
  const pollMs = options.pollMs ?? 0;
  const pollInBackground = options.pollInBackground === true;
  useEffect(() => {
    if (pollMs <= 0) return;

    let timer: number | null = null;
    const tick = () => {
      if (!pollInBackground && typeof document !== "undefined" && document.hidden) {
        return;
      }
      silentRefetch();
    };
    timer = window.setInterval(tick, pollMs);

    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        silentRefetch();
      }
    };
    if (!pollInBackground && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (timer !== null) window.clearInterval(timer);
      if (!pollInBackground && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [pollMs, pollInBackground, silentRefetch]);

  return { data, error, loading, refetch, silentRefetch };
}
