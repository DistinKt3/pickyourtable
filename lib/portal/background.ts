import "server-only";
import { after } from "next/server";
import { log } from "@/lib/log";

/**
 * Work that must not change how long a response takes, such as looking up an email
 * and sending a sign-in link: the answer is the same whether or not the account
 * exists, and so is its timing. Inside Next.js the work runs after the response with
 * `after()`. Outside a request (tests and scripts) it runs on the next tick, and
 * `settleBackgroundWork()` waits for it.
 */

const pending = new Set<Promise<void>>();

export function runAfterResponse(name: string, work: () => Promise<void>): void {
  const guarded = async () => {
    try {
      await work();
    } catch (error) {
      log.error("portal.background_failed", { task: name, error });
    }
  };
  try {
    after(guarded);
  } catch {
    const p = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(guarded);
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
}

/** Waits for background work started outside a request (tests). */
export async function settleBackgroundWork(): Promise<void> {
  while (pending.size) await Promise.all(pending);
}
