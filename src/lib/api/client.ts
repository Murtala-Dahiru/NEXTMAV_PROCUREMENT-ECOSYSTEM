// NextMav Procure — browser API client.
//
// One place that knows how to talk to the server, so error handling, the typed
// error envelope and toast behaviour are consistent across every view rather
// than re-invented per call site.

"use client";

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: { issues?: { path: string; message: string }[] } & Record<string, unknown>;
}

/** Thrown for any non-2xx response. Carries the server's typed error envelope. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ApiErrorPayload["details"];

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }

  /** Field-level messages from a 422, keyed by form field name. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.details?.issues ?? []) {
      if (!out[issue.path]) out[issue.path] = issue.message;
    }
    return out;
  }

  get isValidation() { return this.status === 422; }
  get isForbidden() { return this.status === 403; }
  get isUnauthenticated() { return this.status === 401; }
  /** 409 — a business rule refused the transition, not a bug. */
  get isConflict() { return this.status === 409; }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, {
      code: "NETWORK",
      message: "Could not reach the server. Check your connection and try again.",
    });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    const envelope = (payload as { error?: ApiErrorPayload })?.error;
    throw new ApiError(
      res.status,
      envelope ?? { code: "INTERNAL", message: "Something went wrong. Please try again." }
    );
  }

  return payload as T;
}

const qs = (params?: Record<string, unknown>) => {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== "ALL") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>("GET", `${path}${qs(params)}`),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/**
 * Runs a mutation with consistent user feedback.
 *
 * Business-rule refusals (409) and validation failures (422) are shown as the
 * server worded them — those messages explain *why* an action is not allowed and
 * are more useful than a generic failure toast.
 */
export async function mutate<T>(
  fn: () => Promise<T>,
  options: { success?: string; onError?: (e: ApiError) => void } = {}
): Promise<T | null> {
  const { toast } = await import("sonner");
  try {
    const result = await fn();
    if (options.success) toast.success(options.success);
    return result;
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, { code: "INTERNAL", message: String(e) });

    if (err.isUnauthenticated) {
      toast.error("Your session has expired", { description: "Please sign in again." });
      // Let the shell re-render the login screen rather than hard-reloading.
      const { useStore } = await import("@/lib/store");
      useStore.setState({ isAuthed: false });
      return null;
    }

    if (err.isValidation) {
      const first = Object.values(err.fieldErrors)[0];
      toast.error("Check the form", { description: first ?? err.message });
    } else if (err.isForbidden) {
      toast.error("Not permitted", { description: err.message });
    } else if (err.isConflict) {
      toast.error("Action not allowed", { description: err.message });
    } else {
      toast.error("Something went wrong", { description: err.message });
    }

    options.onError?.(err);
    return null;
  }
}
