import { requireCron } from "@/lib/booking/http";
import { retention } from "@/lib/booking/jobs";
import { api } from "@/lib/http/api";

export const maxDuration = 60;

/** GET /api/jobs/retention (daily cron): deletes guest data 24 months after the visit. */
export const GET = api({}, async ({ req }) => {
  requireCron(req);
  return retention();
});
