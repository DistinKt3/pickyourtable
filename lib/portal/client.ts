/**
 * Browser-side calls to the portal API. Errors come back as PortalError with the
 * server's code and plain-words message. A signed-out answer sends the operator to
 * sign-in.
 */

export class PortalError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function portalFetch<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers:
        init.body === undefined
          ? { accept: "application/json" }
          : { "content-type": "application/json", accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new PortalError(0, "offline", "Can't reach the server. Check the connection; nothing was changed.");
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code: string; message: string; [k: string]: unknown } }
    | null;
  if (!res.ok) {
    const err = data && "error" in data && data.error ? data.error : null;
    if (res.status === 401 && typeof window !== "undefined") window.location.assign("/portal/sign-in?expired=1");
    const { code, message, ...extra } = err ?? { code: "server_error", message: "Something went wrong. Please try again." };
    throw new PortalError(res.status, code, message, extra);
  }
  return data as T;
}
