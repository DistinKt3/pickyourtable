import "server-only";
import type { NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { isWidgetEnabled } from "@/lib/flags";
import { log } from "@/lib/log";
import { randomToken } from "@/lib/security/crypto";
import { isSameOrigin } from "@/lib/security/request";

/**
 * Every route handler goes through `api()`. It enforces, in order: the kill switch for
 * guest routes, same-origin for state-changing requests, a JSON content type and a body
 * size cap, then zod validation of params, query and body. Errors come back as
 * `{ error: { code, message } }` and are logged once; responses are never cached.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export interface ApiContext<P, Q, B> {
  req: NextRequest;
  params: P;
  query: Q;
  body: B;
  requestId: string;
}

interface Options<P, Q, B> {
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  /** Guest-facing routes honor the `pyt_widget_enabled` kill switch (PRD S-5). */
  guest?: boolean;
  /** Defaults to true for every method except GET and HEAD. */
  sameOrigin?: boolean;
  maxBodyBytes?: number;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function api<P = Record<string, never>, Q = undefined, B = undefined>(
  opts: Options<P, Q, B>,
  handler: (ctx: ApiContext<P, Q, B>) => Promise<Response | object>,
) {
  return async (req: NextRequest, route: { params: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || randomToken(9);
    try {
      if (opts.guest && !(await isWidgetEnabled())) {
        throw new ApiError(503, "widget_disabled", "Online table selection is paused right now.");
      }
      const unsafe = UNSAFE.has(req.method);
      if ((opts.sameOrigin ?? unsafe) && !isSameOrigin(req)) {
        throw new ApiError(403, "cross_origin", "This request must come from the booking page.");
      }

      const params = opts.params ? opts.params.parse(await route.params) : ({} as P);
      const query = opts.query ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams.entries())) : (undefined as Q);

      let body = undefined as B;
      if (opts.body) {
        const type = req.headers.get("content-type") ?? "";
        if (!type.toLowerCase().startsWith("application/json")) {
          throw new ApiError(415, "unsupported_media_type", "Send JSON.");
        }
        const text = await req.text();
        if (text.length > (opts.maxBodyBytes ?? 16_384)) throw new ApiError(413, "too_large", "Request is too large.");
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
        }
        body = opts.body.parse(json);
      }

      const result = await handler({ req, params, query, body, requestId });
      const res = result instanceof Response ? result : Response.json(result);
      return withHeaders(res, requestId);
    } catch (e) {
      return withHeaders(errorResponse(e, req, requestId), requestId);
    }
  };
}

function errorResponse(e: unknown, req: NextRequest, requestId: string): Response {
  if (e instanceof ApiError) {
    if (e.status >= 500) log.error("api.error", { requestId, path: req.nextUrl.pathname, code: e.code });
    return Response.json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status, headers: e.headers });
  }
  if (e instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "Some details are missing or not valid.",
          issues: e.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  log.error("api.unhandled", { requestId, path: req.nextUrl.pathname, method: req.method, error: e });
  return Response.json(
    { error: { code: "server_error", message: "Something went wrong on our side. Please try again." } },
    { status: 500 },
  );
}

function withHeaders(res: Response, requestId: string): Response {
  if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
  res.headers.set("x-request-id", requestId);
  return res;
}

export function tooMany(retryAfterSeconds: number, message = "Too many attempts. Please wait a moment and try again."): ApiError {
  return new ApiError(429, "rate_limited", message, { retryAfterSeconds }, { "retry-after": String(retryAfterSeconds) });
}
