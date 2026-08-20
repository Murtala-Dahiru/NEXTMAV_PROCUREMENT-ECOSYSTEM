// NextMav Procure — reading server data from a view.
//
// Most screens read the organization out of the Zustand store, which is filled
// once by /api/bootstrap. The vendor directory and profile cannot: they page,
// filter and sort in the database, so they fetch per view state.
//
// Doing that with a bare `useEffect` that flips a loading flag has two problems.
// The obvious one is races — a slow first response overwriting a fast second.
// The subtler one is that setting state synchronously inside an effect makes
// React render twice for every parameter change, which the project's lint rules
// reject on exactly those grounds.
//
// So: the effect starts the request and nothing else. Every state write happens
// in the promise's continuation, and `loading` is *derived* from whether the
// state on hand was produced by the fetcher currently in force, rather than
// tracked as a separate flag that can disagree with it.

"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api/client";

interface State<T> {
  /** The fetcher whose result this is. Identity comparison drives `loading`. */
  source: unknown;
  data: T | null;
  error: string | null;
}

export interface ServerData<T> {
  data: T | null;
  error: string | null;
  /** True while the data on hand belongs to a previous set of parameters. */
  loading: boolean;
  /** Re-runs the current fetcher. Safe to call from event handlers. */
  reload: () => Promise<void>;
}

const messageOf = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : fallback;

/**
 * Runs `fetcher` whenever its identity changes.
 *
 * The caller is expected to wrap it in `useCallback` over exactly the inputs the
 * request depends on — that memo is what defines "a different request" here.
 */
export function useServerData<T>(
  fetcher: () => Promise<T>,
  fallbackError = "Could not load this data."
): ServerData<T> {
  const [state, setState] = useState<State<T>>({ source: null, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetcher().then(
      (data) => {
        if (!cancelled) setState({ source: fetcher, data, error: null });
      },
      (e) => {
        // The previous data is kept so a failed refresh leaves the screen
        // showing what it had, with the error beside it, rather than blanking.
        if (!cancelled) {
          setState((s) => ({ source: fetcher, data: s.data, error: messageOf(e, fallbackError) }));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [fetcher, fallbackError]);

  const reload = useCallback(async () => {
    try {
      const data = await fetcher();
      setState({ source: fetcher, data, error: null });
    } catch (e) {
      setState((s) => ({ source: fetcher, data: s.data, error: messageOf(e, fallbackError) }));
    }
  }, [fetcher, fallbackError]);

  return {
    data: state.data,
    error: state.error,
    loading: state.source !== fetcher,
    reload,
  };
}
