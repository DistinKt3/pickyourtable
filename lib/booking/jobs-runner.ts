import "server-only";
import { log } from "@/lib/log";
import { tick } from "./jobs";

/**
 * Runs `tick()` every 30 seconds inside the server process (JOBS_INPROCESS=1, for local
 * development and single-instance hosts). Deployed on Vercel, cron calls
 * /api/jobs/tick instead. One run at a time; a slow run skips the next beat.
 */

const g = globalThis as unknown as { __pytJobsTimer?: ReturnType<typeof setInterval> };

export const TICK_INTERVAL_MS = 30_000;

export function startInProcessJobs(intervalMs = TICK_INTERVAL_MS): void {
  if (g.__pytJobsTimer) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const report = await tick();
      if (report.expired || report.intentsClosed || report.latePayments || report.refundsSettled) {
        log.info("job.tick", { ...report, outcome: "ok" });
      }
    } catch (e) {
      log.error("job.tick_failed", { outcome: "error", error: e });
    } finally {
      running = false;
    }
  };
  g.__pytJobsTimer = setInterval(() => void run(), intervalMs);
  g.__pytJobsTimer.unref?.();
  log.info("job.started", { intervalMs, outcome: "in_process" });
}
