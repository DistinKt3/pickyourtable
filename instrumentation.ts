/**
 * Server start-up hook. With JOBS_INPROCESS=1 on the Node.js runtime, the 30-second
 * booking job (expire unpaid holds, close their PaymentIntents, retry refunds) runs in
 * this process (PRD: "A job every 30 s"). Deployments use cron on /api/jobs/tick.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.JOBS_INPROCESS !== "1") return;
  // Never during `next build`, whose workers also load this file.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startInProcessJobs } = await import("./lib/booking/jobs-runner");
  startInProcessJobs();
}
