/**
 * Fetch wrapper for the BookLeaf API. Auth is an httpOnly cookie set by the
 * server, so no token is ever stored in JS (or localStorage).
 */

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
  }

  /** Field -> message map for showing validation errors next to inputs */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.field, d.message]));
  }
}

type Query = Record<string, string | number | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query } = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const res = await fetch(withQuery(`/api${path}`, options.query), {
    method,
    credentials: "include",
    headers: options.body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const error = payload?.error;
    throw new ApiError(res.status, error?.code ?? "UNKNOWN", error?.message ?? `Request failed (${res.status})`, error?.details);
  }
  return payload as T;
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
};
