import { type BookingsResponse, bookingsQuery } from "@/lib/api/contracts";
import { listBookings } from "@/lib/booking/operations";
import { api } from "@/lib/http/api";
import { portalReader } from "@/lib/portal/guard";
import { callOperation } from "@/lib/portal/operations";

export const dynamic = "force-dynamic";

/** Bookings (PRD O-2): search and filter the venue's paid bookings. */
export const GET = api({ query: bookingsQuery }, async ({ req, query }): Promise<BookingsResponse> => {
  const op = await portalReader(req);
  return callOperation(() =>
    listBookings({ venueId: op.venueId, q: query.q || undefined, status: query.status, from: query.from, to: query.to }),
  );
});
