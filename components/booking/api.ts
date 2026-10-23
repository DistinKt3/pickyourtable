"use client";

import type {
  AvailabilityResponse,
  BookingDetails,
  CheckoutResponse,
  CreateHoldBody,
  CreateHoldResponse,
  ErrorBody,
  GuestDetails,
  HoldStatusResponse,
  ManageResponse,
  SlotsResponse,
  TableSuggestion,
  TableTimesResponse,
} from "@/lib/api/contracts";

/**
 * Typed client for the guest API (lib/api/contracts.ts). Every call returns either
 * data or an ApiFailure carrying the server's plain-words message.
 */

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get offline(): boolean {
    return this.code === "offline";
  }
}

const DEVICE_KEY = "pyt.device";

/** Random per-device id for the 2-holds-per-device limit; guests are cookieless. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const id = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "nostorage-device-0000";
  }
}

/** Offset between the server clock and this device, so countdowns are honest. */
let serverSkewMs = 0;
export function serverNow(): number {
  return Date.now() + serverSkewMs;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-pyt-device", deviceId());
  if (init.body) headers.set("content-type", "application/json");
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new ApiFailure(0, "offline", "You're offline.");
  }
  const date = res.headers.get("date");
  if (date) {
    const server = Date.parse(date);
    if (Number.isFinite(server)) serverSkewMs = server - Date.now();
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as ErrorBody | null)?.error;
    throw new ApiFailure(
      res.status,
      err?.code ?? "server_error",
      err?.message ?? "Something went wrong on our side. Please try again.",
      err ?? {},
    );
  }
  return json as T;
}

const q = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  availability: (venue: string, date: string, time: string, party: number, signal?: AbortSignal) =>
    call<AvailabilityResponse>(`/api/v/${venue}/availability?${q({ date, time, party })}`, { signal }),
  slots: (venue: string, date: string, party: number, signal?: AbortSignal) =>
    call<SlotsResponse>(`/api/v/${venue}/slots?${q({ date, party })}`, { signal }),
  tableTimes: (venue: string, code: string, date: string, time: string, party: number) =>
    call<TableTimesResponse>(`/api/v/${venue}/tables/${code}/times?${q({ date, time, party, limit: 5 })}`),
  createHold: (venue: string, body: CreateHoldBody) =>
    call<CreateHoldResponse>(`/api/v/${venue}/holds`, { method: "POST", body: JSON.stringify(body) }),
  holdStatus: (id: string, token: string) => call<HoldStatusResponse>(`/api/holds/${id}`, { token }),
  releaseHold: (id: string, token: string) => call<{ ok: true }>(`/api/holds/${id}`, { method: "DELETE", token }),
  checkout: (id: string, token: string, guest: GuestDetails) =>
    call<CheckoutResponse>(`/api/holds/${id}/checkout`, { method: "POST", token, body: JSON.stringify({ guest }) }),
  simConfirm: (paymentIntentId: string, body: { clientSecret: string; outcome: string; brand: string; last4: string }) =>
    call<{ status: string; error: { code: string; message: string } | null }>(
      `/api/sim/payment-intents/${paymentIntentId}/confirm`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  manage: (token: string) => call<ManageResponse>(`/api/manage/${encodeURIComponent(token)}`),
  cancel: (token: string) =>
    call<{ status: "cancelled"; refundCents: number }>(`/api/manage/${encodeURIComponent(token)}/cancel`, { method: "POST" }),
};

export function suggestionFrom(e: ApiFailure): TableSuggestion | null {
  const alt = e.extra.alternative as TableSuggestion | null | undefined;
  return alt && typeof alt.code === "string" ? alt : null;
}

export type { BookingDetails };
