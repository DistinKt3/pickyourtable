import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres 18. The no-overlap exclusion constraint on `reservation.during` lives in
 * the hand-written migration `db/migrations/0001_no_overlap.sql`, because drizzle-kit
 * cannot express EXCLUDE constraints.
 */

const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const reservationStatus = pgEnum("reservation_status", ["held", "confirmed", "cancelled", "expired", "seated", "no_show"]);
export const operatorRole = pgEnum("operator_role", ["owner", "host"]);
export const dayType = pgEnum("day_type", ["weeknight", "weekend", "special"]);

export const venue = pgTable("venue", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  stripeAccountId: text("stripe_account_id"),
  applicationFeeBps: integer("application_fee_bps").notNull().default(3000),
  live: boolean("live").notNull().default(false),
  wentLiveAt: tz("went_live_at"),
  createdAt: createdAt(),
});

export const venueTable = pgTable(
  "venue_table",
  {
    id: id(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    tier: text("tier").notNull(),
    seats: integer("seats").notNull(),
    minParty: integer("min_party").notNull(),
    maxParty: integer("max_party").notNull(),
    attributes: text("attributes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    photoId: text("photo_id"),
    bookable: boolean("bookable").notNull(),
    sort: integer("sort").notNull().default(0),
    approvedAt: tz("approved_at"),
    approvedBy: uuid("approved_by"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("venue_table_code").on(t.venueId, t.code),
    check("venue_table_party", sql`${t.minParty} >= 1 AND ${t.minParty} <= ${t.maxParty} AND ${t.maxParty} <= ${t.seats}`),
  ],
);

export const priceRule = pgTable(
  "price_rule",
  {
    id: id(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    daypart: text("daypart").notNull(),
    dayType: dayType("day_type").notNull(),
    specialDate: date("special_date"),
    feeCents: integer("fee_cents").notNull(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("price_rule_key").on(
      t.venueId,
      t.tier,
      t.daypart,
      t.dayType,
      sql`coalesce(${t.specialDate}, '1970-01-01'::date)`,
    ),
    check("price_rule_fee", sql`${t.feeCents} >= 0 AND ${t.feeCents} <= 100000`),
    check("price_rule_special", sql`(${t.dayType} = 'special') = (${t.specialDate} IS NOT NULL)`),
  ],
);

export const turnTime = pgTable(
  "turn_time",
  {
    id: id(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),
    minParty: integer("min_party").notNull(),
    maxParty: integer("max_party").notNull(),
    minutes: integer("minutes").notNull(),
  },
  (t) => [
    uniqueIndex("turn_time_range").on(t.venueId, t.minParty),
    check("turn_time_valid", sql`${t.minParty} >= 1 AND ${t.maxParty} >= ${t.minParty} AND ${t.minutes} BETWEEN 30 AND 360`),
  ],
);

export const guest = pgTable("guest", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  mobile: text("mobile").notNull(),
  occasion: text("occasion"),
  note: text("note"),
  createdAt: createdAt(),
});

export const reservation = pgTable(
  "reservation",
  {
    id: id(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => venueTable.id),
    partySize: integer("party_size").notNull(),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    during: tstzrange("during")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    daypart: text("daypart").notNull(),
    dayType: dayType("day_type").notNull(),
    status: reservationStatus("status").notNull(),
    holdExpiresAt: tz("hold_expires_at"),
    guestId: uuid("guest_id").references(() => guest.id, { onDelete: "set null" }),
    priceCents: integer("price_cents").notNull(),
    applicationFeeCents: integer("application_fee_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    paymentIntentId: text("payment_intent_id"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    /** SHA-256 of the guest's device id, for the 2-holds-per-device limit. */
    deviceHash: text("device_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    /** Lowercased email, copied from the guest for the 2-holds-per-email limit. */
    emailNorm: text("email_norm"),
    /** Random value inside the manage link; rotating it revokes old links. */
    manageNonce: text("manage_nonce").notNull(),
    seatedTableId: uuid("seated_table_id").references(() => venueTable.id),
    refundCents: integer("refund_cents").notNull().default(0),
    /**
     * Total the guest is owed back, written before the provider refund is requested.
     * `refund_cents` catches up once the provider confirms; the job retries any gap.
     */
    refundDueCents: integer("refund_due_cents").notNull().default(0),
    refundId: text("refund_id"),
    refundedAt: tz("refunded_at"),
    /** Plain-words reason for the latest declined payment, shown while the hold lasts. */
    paymentError: text("payment_error"),
    /** When the PaymentIntent of an ended hold was cancelled at the provider. */
    paymentIntentCanceledAt: tz("payment_intent_canceled_at"),
    confirmedAt: tz("confirmed_at"),
    seatedAt: tz("seated_at"),
    cancelledAt: tz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reservation_payment_intent").on(t.paymentIntentId),
    index("reservation_venue_start").on(t.venueId, t.startsAt),
    index("reservation_hold_expiry").on(t.status, t.holdExpiresAt),
    index("reservation_device_active").on(t.deviceHash, t.status),
    index("reservation_email_active").on(t.emailNorm, t.status),
    check("reservation_range", sql`${t.endsAt} > ${t.startsAt}`),
    check("reservation_party", sql`${t.partySize} BETWEEN 1 AND 20`),
    check(
      "reservation_price",
      sql`${t.priceCents} >= 0 AND ${t.applicationFeeCents} >= 0 AND ${t.applicationFeeCents} <= ${t.priceCents}`,
    ),
    check("reservation_refund", sql`${t.refundCents} >= 0 AND ${t.refundCents} <= ${t.priceCents}`),
    check("reservation_hold_expiry_set", sql`${t.status} <> 'held' OR ${t.holdExpiresAt} IS NOT NULL`),
    check("reservation_refund_due", sql`${t.refundDueCents} >= 0 AND ${t.refundDueCents} <= ${t.priceCents}`),
    /** Ended holds whose PaymentIntent may still be open at the provider (the 30 s job). */
    index("reservation_open_intent")
      .on(t.holdExpiresAt)
      .where(
        sql`${t.status} = 'expired' AND ${t.paymentIntentId} IS NOT NULL AND ${t.paymentIntentCanceledAt} IS NULL AND ${t.confirmedAt} IS NULL AND ${t.refundDueCents} = 0`,
      ),
    /** Refunds owed but not yet confirmed by the provider. */
    index("reservation_refund_pending")
      .on(t.updatedAt)
      .where(sql`${t.refundDueCents} > ${t.refundCents}`),
  ],
);

export const blackout = pgTable(
  "blackout",
  {
    id: id(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),
    /** Null blocks every table in the venue. */
    tableId: uuid("table_id").references(() => venueTable.id, { onDelete: "cascade" }),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    during: tstzrange("during")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("blackout_venue").on(t.venueId, t.startsAt), check("blackout_range", sql`${t.endsAt} > ${t.startsAt}`)],
);

export const operator = pgTable(
  "operator",
  {
    id: id(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venue.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: operatorRole("role").notNull(),
    disabledAt: tz("disabled_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("operator_email").on(t.email)],
);

export const magicLink = pgTable(
  "magic_link",
  {
    id: id(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operator.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("magic_link_token").on(t.tokenHash)],
);

export const session = pgTable(
  "session",
  {
    id: id(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operator.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: tz("expires_at").notNull(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("session_token").on(t.tokenHash)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    venueId: text("venue_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    reservationId: uuid("reservation_id"),
    amountCents: integer("amount_cents"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_venue").on(t.venueId, t.createdAt), index("audit_log_reservation").on(t.reservationId)],
);

export const webhookEvent = pgTable("webhook_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: tz("received_at").notNull().defaultNow(),
  processedAt: tz("processed_at"),
});

export const featureFlag = pgTable("feature_flag", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const rateLimit = pgTable(
  "rate_limit",
  {
    key: text("key").notNull(),
    windowStart: tz("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Every email the app sends. In development this is also the /dev/mail inbox. */
export const emailMessage = pgTable(
  "email_message",
  {
    id: id(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    attachments: jsonb("attachments").notNull().default([]),
    tag: text("tag").notNull(),
    reservationId: uuid("reservation_id"),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    createdAt: createdAt(),
  },
  (t) => [index("email_message_created").on(t.createdAt)],
);

/* Simulated Stripe, used only when PAYMENTS_MODE=sim. Same shapes as Stripe objects. */

export const simPaymentIntent = pgTable(
  "sim_payment_intent",
  {
    id: text("id").primaryKey(),
    clientSecret: text("client_secret").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    applicationFeeAmount: integer("application_fee_amount").notNull(),
    destination: text("destination").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    lastError: jsonb("last_error"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    createdAt: createdAt(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sim_pi_idempotency").on(t.idempotencyKey)],
);

export const simRefund = pgTable(
  "sim_refund",
  {
    id: text("id").primaryKey(),
    paymentIntentId: text("payment_intent_id").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sim_refund_idempotency").on(t.idempotencyKey)],
);

export const simEvent = pgTable("sim_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
  deliveredAt: tz("delivered_at"),
});

export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type OperatorRole = (typeof operatorRole.enumValues)[number];
export type DayType = (typeof dayType.enumValues)[number];
