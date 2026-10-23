import "./_env";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { venue } from "@/db/schema";
import { env } from "@/lib/env";
import { stripeClient } from "@/lib/payments/stripe";
import { loadVenue } from "@/lib/venue/load";

/**
 * Creates a Stripe Connect test-mode connected account for a venue, for destination
 * charges, and prints its id and an onboarding link. Test-mode keys only (env.ts
 * refuses live keys).
 *
 *   npx tsx --conditions=react-server scripts/stripe-setup.ts halcyon [--save]
 *
 * --save writes the account id to the venue row. Otherwise put it in
 * STRIPE_CONNECTED_ACCOUNT_ID and run `pnpm db:seed`.
 */

const args = process.argv.slice(2);
const venueId = args.find((a) => !a.startsWith("--")) ?? "halcyon";
const save = args.includes("--save");

const e = env();
if (!e.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is not set. Add a test-mode key (sk_test_...) to .env.local first.");
  process.exit(2);
}

try {
  const v = await loadVenue(venueId);
  const stripe = stripeClient();
  const account = await stripe.accounts.create(
    {
      country: "US",
      email: v.contact.email,
      controller: {
        fees: { payer: "application" },
        losses: { payments: "application" },
        stripe_dashboard: { type: "express" },
      },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: v.name, product_description: "Table reservations with a guaranteed table fee" },
      metadata: { venue_id: v.id },
    },
    { idempotencyKey: `connect-account-${v.id}` },
  );
  const link = await stripe.accountLinks.create({
    account: account.id,
    type: "account_onboarding",
    refresh_url: new URL("/portal", e.APP_URL).toString(),
    return_url: new URL("/portal", e.APP_URL).toString(),
  });
  if (save) await db().update(venue).set({ stripeAccountId: account.id }).where(eq(venue.id, v.id));
  console.log(
    JSON.stringify(
      { event: "stripe.connected_account", venue: v.id, accountId: account.id, onboardingUrl: link.url, saved: save },
      null,
      2,
    ),
  );
} finally {
  await closeDb();
}
