import "server-only";
import { errors, jwtVerify, SignJWT } from "jose";
import { derivedKey } from "./crypto";

/**
 * Signed, purpose-bound tokens (HS256, algorithm pinned on verify).
 *
 * - manage: the guest's manage link. Bound to one reservation and its current nonce;
 *   expires after the visit date (PRD privacy controls).
 * - hold:   proves the caller created this hold, so only they can check out or release it.
 */

export type TokenPurpose = "manage" | "hold";

const ISSUER = "pyt";

export interface TokenClaims {
  /** Reservation id. */
  sub: string;
  /** Manage tokens carry the reservation's nonce; rotating it revokes the link. */
  nonce?: string;
  exp: number;
}

export async function signToken(
  purpose: TokenPurpose,
  claims: { sub: string; nonce?: string; expiresAt: Date },
): Promise<string> {
  const jwt = new SignJWT(claims.nonce ? { nonce: claims.nonce } : {})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(purpose)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(claims.expiresAt.getTime() / 1000));
  return jwt.sign(derivedKey(`token-${purpose}`));
}

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: "expired" | "invalid" };

export async function verifyToken(purpose: TokenPurpose, token: string): Promise<VerifyResult> {
  if (typeof token !== "string" || token.length > 1024 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const { payload } = await jwtVerify(token, derivedKey(`token-${purpose}`), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: purpose,
      requiredClaims: ["sub", "exp"],
    });
    return {
      ok: true,
      claims: {
        sub: String(payload.sub),
        exp: payload.exp!,
        ...(typeof payload.nonce === "string" ? { nonce: payload.nonce } : {}),
      },
    };
  } catch (e) {
    if (e instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
