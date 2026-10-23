import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { type OperatorRole, magicLink, operator, session } from "@/db/schema";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/http/api";
import { randomToken, sha256 } from "@/lib/security/crypto";

/**
 * Operator sign-in (PRD: magic link, Owner and Host roles).
 *
 * - Magic links are 256-bit random tokens, stored only as SHA-256 hashes, valid for
 *   15 minutes and usable once. Redeeming needs a POST, so mail scanners that prefetch
 *   links cannot burn or use them.
 * - Sessions are random tokens in an HttpOnly, Secure, SameSite=Lax `__Host-` cookie,
 *   stored hashed, valid for 12 hours.
 * - Roles are enforced here, on the server, for every portal request.
 */

export const MAGIC_LINK_TTL_MINUTES = 15;
export const SESSION_TTL_HOURS = 12;

export interface OperatorSession {
  sessionId: string;
  operatorId: string;
  venueId: string;
  email: string;
  name: string;
  role: OperatorRole;
}

export function sessionCookieName(): string {
  const url = new URL(env().APP_URL);
  const secure = url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return secure ? "__Host-pyt_session" : "pyt_session";
}

export function sessionCookieOptions(expires: Date) {
  const secure = sessionCookieName().startsWith("__Host-");
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Creates a magic link for an active operator. Returns null for unknown emails; callers must not reveal which. */
export async function issueMagicLink(email: string): Promise<{ token: string; operator: typeof operator.$inferSelect } | null> {
  const rows = await db()
    .select()
    .from(operator)
    .where(and(eq(operator.email, normalizeEmail(email)), isNull(operator.disabledAt)));
  const op = rows[0];
  if (!op) return null;
  const token = randomToken(32);
  await db()
    .insert(magicLink)
    .values({ operatorId: op.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60_000) });
  return { token, operator: op };
}

/** Redeems a magic link exactly once and opens a session. */
export async function redeemMagicLink(
  token: string,
): Promise<{ sessionToken: string; expiresAt: Date; operatorId: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db().transaction(async (tx) => {
    const used = await tx
      .update(magicLink)
      .set({ usedAt: new Date() })
      .where(and(eq(magicLink.tokenHash, sha256(token)), isNull(magicLink.usedAt), gt(magicLink.expiresAt, new Date())))
      .returning({ operatorId: magicLink.operatorId });
    const row = used[0];
    if (!row) return null;
    const op = await tx
      .select()
      .from(operator)
      .where(and(eq(operator.id, row.operatorId), isNull(operator.disabledAt)));
    if (!op[0]) return null;
    const sessionToken = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000);
    await tx.insert(session).values({ operatorId: row.operatorId, tokenHash: sha256(sessionToken), expiresAt });
    return { sessionToken, expiresAt, operatorId: row.operatorId };
  });
}

async function operatorForToken(token: string | undefined): Promise<OperatorSession | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await db()
    .select({
      sessionId: session.id,
      operatorId: operator.id,
      venueId: operator.venueId,
      email: operator.email,
      name: operator.name,
      role: operator.role,
    })
    .from(session)
    .innerJoin(operator, eq(operator.id, session.operatorId))
    .where(and(eq(session.tokenHash, sha256(token)), gt(session.expiresAt, new Date()), isNull(operator.disabledAt)));
  return rows[0] ?? null;
}

/** For route handlers: the signed-in operator, or a 401/403 ApiError. */
export async function requireOperator(req: NextRequest, roles: OperatorRole[] = ["owner", "host"]): Promise<OperatorSession> {
  const op = await operatorForToken(req.cookies.get(sessionCookieName())?.value);
  if (!op) throw new ApiError(401, "signed_out", "Please sign in again.");
  if (!roles.includes(op.role)) throw new ApiError(403, "forbidden", "Your role cannot do this. Ask the venue owner.");
  return op;
}

/** For server components and pages. */
export async function currentOperator(): Promise<OperatorSession | null> {
  const jar = await cookies();
  return operatorForToken(jar.get(sessionCookieName())?.value);
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db()
    .delete(session)
    .where(eq(session.tokenHash, sha256(token)));
}
