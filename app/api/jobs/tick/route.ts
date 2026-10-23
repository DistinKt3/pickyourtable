import { requireCron } from "@/lib/booking/http";
import { tick } from "@/lib/booking/jobs";
import { api } from "@/lib/http/api";

export const maxDuration = 60;

/** GET /api/jobs/tick (cron, every 30 s or as often as the host allows): expires holds, closes intents, retries refunds. */
export const GET = api({}, async ({ req }) => {
  requireCron(req);
  return tick();
});
