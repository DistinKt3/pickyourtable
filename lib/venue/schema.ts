import { z } from "zod";

/**
 * The venue data contract (PRD D-1). One `venue.json` per venue folder drives the
 * 3D scene, the 2D plan, the list view and the seat renders. Units are meters,
 * angles are degrees.
 *
 * Coordinates: x grows east, z grows south, so north is -z. The origin is the
 * north-west interior corner of the room. Compass angles (`rotation`, `view.yaw`)
 * are measured clockwise from north, as seen from above.
 */

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and dashes");
const tableCode = z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/, "uppercase code like W1");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex color like #1C5D63");
const meters = z.number().finite().min(-200).max(200);
const point = z.tuple([meters, meters]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "24-hour time like 17:00");
const isoWeekday = z.number().int().min(1).max(7);
const cents = z.number().int().min(0).max(100_000);
const compass = z.number().min(0).lt(360);

export const ATTRIBUTES = [
  "window",
  "water view",
  "booth",
  "wheelchair accessible",
  "outdoor",
  "kitchen view",
  "quiet",
  "heated",
  "garden view",
  "banquette",
  "corner",
] as const;
export const attributeSchema = z.enum(ATTRIBUTES);

export const tierSchema = z.object({
  id,
  name: z.string().min(1).max(32),
  /** Ring color on the light floor. */
  color: hex,
  /** Ring color on the dark floor. */
  colorDark: hex,
  description: z.string().min(1).max(160),
  /** Whether tables of this tier can be booked online by default. */
  bookable: z.boolean(),
});

export const wallSchema = z.object({
  id,
  from: point,
  to: point,
  kind: z.enum(["solid", "glass", "sliding-door", "doorway"]),
});

export const areaSchema = z.object({
  id,
  kind: z.enum(["dining", "terrace", "kitchen", "service", "promenade", "garden"]),
  name: z.string().min(1).max(40).optional(),
  polygon: z.array(point).min(3).max(64),
});

export const fixtureSchema = z.object({
  id,
  kind: z.enum([
    "pass",
    "kitchen-line",
    "counter",
    "host-stand",
    "service-station",
    "back-of-house",
    "railing",
    "planter",
    "column",
    "bar",
    "banquette",
  ]),
  x: meters,
  z: meters,
  width: z.number().positive().max(40),
  depth: z.number().positive().max(40),
  height: z.number().positive().max(4),
  rotation: compass.default(0),
});

export const tableShape = z.enum(["square", "round", "rect", "booth", "counter"]);

export const tableSchema = z.object({
  id: tableCode,
  label: z.string().min(1).max(32),
  tier: id,
  shape: tableShape,
  seats: z.number().int().min(1).max(12),
  minParty: z.number().int().min(1).max(12),
  maxParty: z.number().int().min(1).max(12),
  x: meters,
  z: meters,
  /** Direction the main seat faces. */
  rotation: compass,
  /** Tabletop size; defaults come from the shape and seat count. */
  width: z.number().positive().max(6).optional(),
  depth: z.number().positive().max(6).optional(),
  /** The seat view: where the main seat looks. */
  view: z.object({
    yaw: compass,
    pitch: z.number().min(-30).max(30),
  }),
  attributes: z.array(attributeSchema).max(3),
  /** A real photo replaces the render when set (PRD D-3). */
  photoId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .nullable(),
  /** Overrides the tier default. */
  bookable: z.boolean().optional(),
});

export const daypartSchema = z.object({
  id,
  name: z.string().min(1).max(24),
  days: z.array(isoWeekday).min(1).max(7),
  start: hhmm,
  end: hhmm,
});

export const turnTimeSchema = z.object({
  minParty: z.number().int().min(1).max(20),
  maxParty: z.number().int().min(1).max(20),
  minutes: z.number().int().min(30).max(360),
});

export const venueSchema = z
  .object({
    $schema: z.string().optional(),
    id,
    demo: z.boolean(),
    name: z.string().min(1).max(48),
    tagline: z.string().max(80).optional(),
    timezone: z.string().refine(isTimeZone, "an IANA time zone like America/Los_Angeles"),
    locale: z.literal("en-US"),
    contact: z.object({
      phone: z.string().min(7).max(24),
      email: z.email(),
      address: z.string().min(1).max(120),
    }),
    brand: z.object({
      accent: hex,
      accentDark: hex,
      /** Text color on top of the accent. */
      onAccent: hex,
    }),
    room: z.object({
      width: z.number().positive().max(100),
      depth: z.number().positive().max(100),
      /** Cutaway wall height in the diorama. */
      wallHeight: z.number().min(0.6).max(1.6),
      /** Real ceiling height, used for seat views. */
      ceilingHeight: z.number().min(2.2).max(8),
    }),
    walls: z.array(wallSchema).min(1).max(64),
    areas: z.array(areaSchema).max(32),
    fixtures: z.array(fixtureSchema).max(128),
    surroundings: z.object({
      ground: z.enum(["stone", "lawn"]),
      water: z.object({ side: z.enum(["north", "south", "east", "west"]), at: meters }).nullable(),
    }),
    tiers: z.array(tierSchema).min(1).max(8),
    tables: z.array(tableSchema).min(1).max(200),
    booking: z.object({
      currency: z.literal("usd"),
      slotMinutes: z.literal(15),
      holdMinutes: z.number().int().min(2).max(30),
      minLeadMinutes: z
        .number()
        .int()
        .min(0)
        .max(24 * 60),
      bookingWindowDays: z.number().int().min(1).max(365),
      /** ISO weekdays priced as weekend (1 = Monday ... 7 = Sunday). */
      weekendDays: z.array(isoWeekday).max(7),
      maxParty: z.number().int().min(1).max(20),
      dayparts: z.array(daypartSchema).min(1).max(6),
      turnTimes: z.array(turnTimeSchema).min(1).max(10),
      fullRefundHours: z
        .number()
        .int()
        .min(0)
        .max(24 * 14),
      applicationFeePercent: z.number().min(0).max(100),
      /** Default fees per tier, in cents. Seeded into price rules for every daypart. */
      fees: z.record(z.string(), z.object({ weeknight: cents, weekend: cents })),
    }),
  })
  .superRefine((v, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

    const tierIds = new Set(v.tiers.map((t) => t.id));
    if (tierIds.size !== v.tiers.length) issue(["tiers"], "tier ids must be unique");

    const codes = new Set<string>();
    v.tables.forEach((t, i) => {
      if (codes.has(t.id)) issue(["tables", i, "id"], `duplicate table id ${t.id}`);
      codes.add(t.id);
      if (!tierIds.has(t.tier)) issue(["tables", i, "tier"], `unknown tier ${t.tier}`);
      if (t.minParty > t.maxParty) issue(["tables", i, "minParty"], "minParty exceeds maxParty");
      if (t.maxParty > t.seats) issue(["tables", i, "maxParty"], "maxParty exceeds seats");
      if (t.maxParty > v.booking.maxParty) issue(["tables", i, "maxParty"], "maxParty exceeds the venue maximum");
    });

    const tableIds = v.tables.map((t) => t.id);
    if (new Set(v.tables.map((t) => t.label)).size !== tableIds.length) issue(["tables"], "table labels must be unique");

    for (const tier of v.tiers) {
      if (tier.bookable && !v.booking.fees[tier.id]) issue(["booking", "fees"], `bookable tier ${tier.id} needs a fee`);
    }
    for (const key of Object.keys(v.booking.fees)) {
      if (!tierIds.has(key)) issue(["booking", "fees", key], `fee for unknown tier ${key}`);
    }

    v.booking.dayparts.forEach((d, i) => {
      if (d.start >= d.end) issue(["booking", "dayparts", i], "daypart must end after it starts");
    });

    const turns = [...v.booking.turnTimes].sort((a, b) => a.minParty - b.minParty);
    let next = 1;
    for (const t of turns) {
      if (t.minParty !== next) issue(["booking", "turnTimes"], "turn times must cover every party size without gaps");
      if (t.maxParty < t.minParty) issue(["booking", "turnTimes"], "turn time range is inverted");
      next = t.maxParty + 1;
    }
    if (next - 1 < v.booking.maxParty) issue(["booking", "turnTimes"], "turn times must cover the maximum party size");

    for (const kind of ["fixtures", "walls", "areas"] as const) {
      const ids = v[kind].map((x) => x.id);
      if (new Set(ids).size !== ids.length) issue([kind], `${kind} ids must be unique`);
    }
  });

export type Venue = z.infer<typeof venueSchema>;
export type VenueTable = z.infer<typeof tableSchema>;
export type Tier = z.infer<typeof tierSchema>;
export type Wall = z.infer<typeof wallSchema>;
export type Area = z.infer<typeof areaSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
export type Daypart = z.infer<typeof daypartSchema>;
export type TableShape = z.infer<typeof tableShape>;
export type Attribute = z.infer<typeof attributeSchema>;

function isTimeZone(tz: string): boolean {
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
    return Boolean(resolved) && (tz.includes("/") || tz === "UTC");
  } catch {
    return false;
  }
}
