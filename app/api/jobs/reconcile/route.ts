import { requireCron } from "@/lib/booking/http";
import { reconcile } from "@/lib/booking/jobs";
import { api } from "@/lib/http/api";

export const maxDuration = 300;

/** GET /api/jobs/reconcile (nightly cron): compares bookings with the payment provider to the cent. */
export const GET = api({}, async ({ req }) => {
  requireCron(req);
  return reconcile();
});
