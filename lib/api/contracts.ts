import { z } from "zod";

/**
 * HTTP contracts between the server and the two UIs. Route handlers parse requests
 * with these schemas; clients type responses with them. Every error response is
 * `{ error: { code, message, ...extra } }`.
 *
 * Times: `date` is YYYY-MM-DD and `time` is HH:MM, both in the venue's time zone.
 * `startsAt`/`endsAt` are ISO 8601 instants in UTC. Money is integer cents.
 */

export const dateStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "YYYY-MM-DD");
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
export const partySize = z.coerce.number().int().min(1).max(20);
export const tableCode = z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/);
export const venueId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const iso = z.string();
export const uuidStr = z.uuid();

export const venueParams = z.object({ venue: venueId });
export const venueTableParams = z.object({ venue: venueId, code: tableCode });
export const idParams = z.object({ id: uuidStr });
export const tokenParams = z.object({ token: z.string().min(20).max(1024) });

export const dayType = z.enum(["weeknight", "weekend", "special"]);

export const slotView = z.object({
  date: dateStr,
  time: timeStr,
  startsAt: iso,
  endsAt: iso,
  daypart: z.string(),
  daypartName: z.string(),
  dayType,
});
export type SlotView = z.infer<typeof slotView>;

export const errorBody = z.object({
  error: z.looseObject({ code: z.string(), message: z.string() }),
});
export type ErrorBody = z.infer<typeof errorBody>;

/* ---------------------------------------------------------------- Guest */

/** GET /api/v/{venue}/availability */
export const availabilityQuery = z.object({ date: dateStr, time: timeStr, party: partySize });

export const tableState = z.enum(["available", "taken", "wrong_size", "not_bookable"]);
export type TableState = z.infer<typeof tableState>;

export const tableAvailability = z.object({
  code: tableCode,
  state: tableState,
  /** Server-computed fee for this slot; null when not bookable. */
  feeCents: z.number().int().nullable(),
  /** Plain-words reason for a dimmed table, such as "Seats 2. Your party is 4." */
  reason: z.string().nullable(),
});
export type TableAvailability = z.infer<typeof tableAvailability>;

export const alternativeTime = z.object({
  date: dateStr,
  time: timeStr,
  startsAt: iso,
  /** Free tables of the tier at that time. */
  tables: z.array(tableCode),
});
export type AlternativeTime = z.infer<typeof alternativeTime>;

export const availabilityResponse = z.object({
  venueId,
  slot: slotView,
  tables: z.array(tableAvailability),
  /**
   * For each bookable tier with no free table in this slot: the 3 nearest times on
   * the same date with a free table of that tier (PRD guest states).
   */
  alternatives: z.record(z.string(), z.array(alternativeTime)),
  generatedAt: iso,
});
export type AvailabilityResponse = z.infer<typeof availabilityResponse>;

/** GET /api/v/{venue}/slots */
export const slotsQuery = z.object({ date: dateStr, party: partySize });
export const slotsResponse = z.object({
  venueId,
  date: dateStr,
  dayparts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      times: z.array(z.object({ time: timeStr, startsAt: iso, freeTables: z.number().int() })),
    }),
  ),
});
export type SlotsResponse = z.infer<typeof slotsResponse>;

/** GET /api/v/{venue}/tables/{code}/times (PRD G-11) */
export const tableTimesQuery = z.object({
  date: dateStr,
  time: timeStr,
  party: partySize,
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export const tableTimesResponse = z.object({
  code: tableCode,
  times: z.array(z.object({ date: dateStr, time: timeStr, startsAt: iso, feeCents: z.number().int() })),
});
export type TableTimesResponse = z.infer<typeof tableTimesResponse>;

export const tableSuggestion = z.object({
  code: tableCode,
  label: z.string(),
  tier: z.string(),
  feeCents: z.number().int(),
});
export type TableSuggestion = z.infer<typeof tableSuggestion>;

export const holdStatus = z.enum(["held", "confirmed", "expired", "cancelled", "seated", "no_show"]);

export const holdView = z.object({
  id: uuidStr,
  venueId,
  table: tableCode,
  tableLabel: z.string(),
  tier: z.string(),
  partySize: z.number().int(),
  slot: slotView,
  priceCents: z.number().int(),
  currency: z.literal("usd"),
  expiresAt: iso,
  status: holdStatus,
});
export type HoldView = z.infer<typeof holdView>;

/** POST /api/v/{venue}/holds. Header `x-pyt-device` carries the device id. */
export const createHoldBody = z.object({
  table: tableCode,
  date: dateStr,
  time: timeStr,
  party: partySize,
  turnstileToken: z.string().min(1).max(2048),
});
export type CreateHoldBody = z.infer<typeof createHoldBody>;

/**
 * 201 on success. Errors: 409 `taken` (with `alternative: TableSuggestion | null`),
 * 409 `wrong_size`, 422 `not_bookable` | `slot_unavailable`, 429 `hold_limit` |
 * `rate_limited`, 403 `turnstile_failed`, 503 `widget_disabled`.
 */
export const createHoldResponse = z.object({ hold: holdView, holdToken: z.string() });
export type CreateHoldResponse = z.infer<typeof createHoldResponse>;

export const paymentState = z.object({
  status: z.enum(["none", "requires_payment", "processing", "succeeded", "failed"]),
  /** Plain-words reason after a decline. */
  message: z.string().nullable(),
});

export const bookingLinks = z.object({
  manageUrl: z.string(),
  calendarUrl: z.string(),
  emailedTo: z.string(),
});

/** GET /api/holds/{id} with `Authorization: Bearer <holdToken>`. Polled during checkout. */
export const holdStatusResponse = z.object({
  hold: holdView,
  payment: paymentState,
  /** Present once the booking is confirmed. */
  booking: bookingLinks.nullable(),
});
export type HoldStatusResponse = z.infer<typeof holdStatusResponse>;

export const guestDetails = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.email("Enter a valid email").max(254),
  mobile: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ().-]{7,20}$/, "Enter a valid mobile number"),
  occasion: z.enum(["anniversary", "birthday", "business", "date-night", "celebration", "other"]).nullable().optional(),
  note: z.string().trim().max(280).nullable().optional(),
});
export type GuestDetails = z.infer<typeof guestDetails>;

/**
 * POST /api/holds/{id}/checkout with the hold token. Saves guest details and creates
 * (or reuses) the PaymentIntent. The amount is the hold's server price; any amount in
 * the request is ignored (PRD S-1). Errors: 409 `hold_expired` | `hold_not_active`,
 * 429 `hold_limit` (2 active holds per email).
 */
export const checkoutBody = z.object({ guest: guestDetails });
export const checkoutResponse = z.object({
  payment: z.object({
    mode: z.enum(["stripe", "sim"]),
    paymentIntentId: z.string(),
    clientSecret: z.string(),
    /** Stripe publishable key in stripe mode; null in sim mode. */
    publishableKey: z.string().nullable(),
    amountCents: z.number().int(),
    currency: z.literal("usd"),
  }),
});
export type CheckoutResponse = z.infer<typeof checkoutResponse>;

/** POST /api/sim/payment-intents/{id}/confirm (sim mode only). */
export const simOutcome = z.enum(["succeeded", "card_declined", "insufficient_funds", "expired_card", "processing_error"]);
export const simConfirmBody = z.object({
  clientSecret: z.string().min(10).max(200),
  outcome: simOutcome,
  brand: z.enum(["visa", "mastercard", "amex", "apple_pay", "google_pay"]),
  last4: z.string().regex(/^\d{4}$/),
});
export const simConfirmResponse = z.object({
  status: z.enum(["succeeded", "requires_payment_method", "processing"]),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const bookingDetails = z.object({
  id: uuidStr,
  venueId,
  venueName: z.string(),
  table: tableCode,
  tableLabel: z.string(),
  tier: z.string(),
  tierName: z.string(),
  partySize: z.number().int(),
  slot: slotView,
  priceCents: z.number().int(),
  currency: z.literal("usd"),
  status: holdStatus,
  guestName: z.string(),
  guestEmail: z.string(),
  occasion: z.string().nullable(),
  note: z.string().nullable(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  refundCents: z.number().int(),
});
export type BookingDetails = z.infer<typeof bookingDetails>;

export const refundPreview = z.object({
  amountCents: z.number().int(),
  policy: z.enum(["full", "none"]),
  /** Plain words, such as "Cancelling 24 hours or more ahead refunds the full $40." */
  explanation: z.string(),
});
export type RefundPreview = z.infer<typeof refundPreview>;

/** GET /api/manage/{token} */
export const manageResponse = z.object({
  booking: bookingDetails,
  refund: refundPreview,
  canCancel: z.boolean(),
  calendarUrl: z.string(),
});
export type ManageResponse = z.infer<typeof manageResponse>;

/** POST /api/manage/{token}/cancel. The refund is recomputed on the server. */
export const manageCancelResponse = z.object({ status: z.literal("cancelled"), refundCents: z.number().int() });

/* --------------------------------------------------------------- Portal */

export const operatorRole = z.enum(["owner", "host"]);

export const signInRequestBody = z.object({ email: z.email().max(254) });
export const signInRedeemBody = z.object({ token: z.string().min(20).max(128) });

export const meResponse = z.object({
  operator: z.object({ name: z.string(), email: z.string(), role: operatorRole }),
  venue: z.object({ id: venueId, name: z.string(), timezone: z.string(), live: z.boolean() }),
});
export type MeResponse = z.infer<typeof meResponse>;

export const portalReservation = z.object({
  id: uuidStr,
  table: tableCode,
  tableLabel: z.string(),
  tier: z.string(),
  /** Where the host actually seated them, when different. */
  seatedTable: tableCode.nullable(),
  partySize: z.number().int(),
  slot: slotView,
  status: holdStatus,
  guestName: z.string(),
  guestEmail: z.string(),
  guestMobile: z.string(),
  occasion: z.string().nullable(),
  note: z.string().nullable(),
  priceCents: z.number().int(),
  refundCents: z.number().int(),
  paid: z.boolean(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  createdAt: iso,
});
export type PortalReservation = z.infer<typeof portalReservation>;

/** GET /api/portal/tonight?date= (defaults to today in the venue's time zone). Polled every 1.5 s. */
export const tonightQuery = z.object({ date: dateStr.optional() });
export const tonightResponse = z.object({
  venueId,
  date: dateStr,
  generatedAt: iso,
  reservations: z.array(portalReservation),
  /** Current state of every table right now (or at the first service of `date`). */
  tables: z.array(z.object({ code: tableCode, state: z.enum(["free", "paid", "seated", "held", "blocked"]) })),
});
export type TonightResponse = z.infer<typeof tonightResponse>;

/** POST /api/portal/reservations/{id}/seat. Seating at another table refunds automatically. */
export const seatBody = z.object({ table: tableCode.optional() });
export const reservationActionResponse = z.object({ reservation: portalReservation, refundCents: z.number().int() });
export type ReservationActionResponse = z.infer<typeof reservationActionResponse>;

/** POST /api/portal/reservations/{id}/cancel (owner). Full refund. */
export const cancelBody = z.object({ reason: z.string().trim().min(2).max(200) });

/** GET /api/portal/bookings */
export const bookingsQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["upcoming", "past", "cancelled", "all"]).default("upcoming"),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
export const bookingsResponse = z.object({ bookings: z.array(portalReservation) });
export type BookingsResponse = z.infer<typeof bookingsResponse>;

export const portalTable = z.object({
  code: tableCode,
  label: z.string(),
  tier: z.string(),
  seats: z.number().int(),
  minParty: z.number().int(),
  maxParty: z.number().int(),
  attributes: z.array(z.string()),
  bookable: z.boolean(),
  photoId: z.string().nullable(),
  approvedAt: iso.nullable(),
});
export type PortalTable = z.infer<typeof portalTable>;

/** GET /api/portal/tables */
export const tablesResponse = z.object({
  tables: z.array(portalTable),
  tiers: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), bookable: z.boolean() })),
  attributes: z.array(z.string()),
});
export type TablesResponse = z.infer<typeof tablesResponse>;

/** PATCH /api/portal/tables/{code} (owner) */
export const updateTableBody = z
  .object({
    bookable: z.boolean().optional(),
    tier: z.string().max(24).optional(),
    attributes: z.array(z.string().max(32)).max(3).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const priceRuleView = z.object({
  id: uuidStr,
  tier: z.string(),
  daypart: z.string(),
  dayType,
  specialDate: dateStr.nullable(),
  feeCents: z.number().int(),
});
export type PriceRuleView = z.infer<typeof priceRuleView>;

export const turnTimeView = z.object({
  minParty: z.number().int().min(1).max(20),
  maxParty: z.number().int().min(1).max(20),
  minutes: z.number().int().min(30).max(360),
});

/** GET /api/portal/pricing */
export const pricingResponse = z.object({
  rules: z.array(priceRuleView),
  turnTimes: z.array(turnTimeView),
  dayparts: z.array(z.object({ id: z.string(), name: z.string(), start: timeStr, end: timeStr, days: z.array(z.number()) })),
  tiers: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), bookable: z.boolean() })),
});
export type PricingResponse = z.infer<typeof pricingResponse>;

/** PUT /api/portal/pricing/rules (owner). Upserts one rule; applies to new holds only (PRD O-3). */
export const upsertPriceRuleBody = z
  .object({
    tier: z.string().max(24),
    daypart: z.string().max(24),
    dayType,
    specialDate: dateStr.nullable().optional(),
    feeCents: z.number().int().min(0).max(100_000),
  })
  .refine((v) => (v.dayType === "special") === Boolean(v.specialDate), "Special-date rules need a date");

/** PUT /api/portal/turn-times (owner). Must cover every party size without gaps. */
export const turnTimesBody = z.object({ turnTimes: z.array(turnTimeView).min(1).max(10) });

export const blackoutView = z.object({
  id: uuidStr,
  table: tableCode.nullable(),
  tableLabel: z.string().nullable(),
  date: dateStr,
  from: timeStr,
  to: timeStr,
  startsAt: iso,
  endsAt: iso,
  reason: z.string(),
});
export type BlackoutView = z.infer<typeof blackoutView>;

/** GET /api/portal/blackouts */
export const blackoutsQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });
export const blackoutsResponse = z.object({ blackouts: z.array(blackoutView) });

/** POST /api/portal/blackouts (owner). `table: null` blocks every table. Guests see it as taken within 10 s (PRD O-4). */
export const createBlackoutBody = z
  .object({
    table: tableCode.nullable(),
    date: dateStr,
    from: timeStr,
    to: timeStr,
    reason: z.string().trim().min(2).max(120),
  })
  .refine((v) => v.from < v.to, "The end time must be after the start time");

/** GET /api/portal/review (owner) */
export const reviewResponse = z.object({
  live: z.boolean(),
  tables: z.array(
    portalTable.extend({
      x: z.number(),
      z: z.number(),
      rotation: z.number(),
      image: z.object({ kind: z.enum(["photo", "render"]), avif: z.string(), webp: z.string(), fallback: z.string() }),
    }),
  ),
});
export type ReviewResponse = z.infer<typeof reviewResponse>;

/** POST /api/portal/review/tables/{code} (owner) */
export const approveBody = z.object({ approved: z.boolean() });
/** POST /api/portal/review/go-live (owner). 409 `not_all_approved` until every table is approved (PRD O-6). */
export const goLiveResponse = z.object({ live: z.literal(true) });
