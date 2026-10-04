/**
 * Who is asking, and whether to believe it.
 *
 * Two questions, answered in that order and never the other way round. First: did
 * this request come from Open WebUI? Only the bearer key of the tool server
 * connection says so, and until it has, nothing in the request is read — not the
 * identity, not the planning it names. Second: on whose behalf? Open WebUI forwards
 * the user either as a signed token (`X-OpenWebUI-User-Jwt`, HS256, when Open WebUI
 * has `FORWARD_USER_INFO_HEADER_JWT_SECRET`) or as plain headers. A plain header is a
 * claim the bearer key alone vouches for; a signed token binds the user to a key only
 * Open WebUI holds, and expires. In signed mode the plain headers are ignored, so a
 * request cannot choose whose plannings it touches.
 *
 * The token is checked by hand rather than through a JWT library: one algorithm,
 * three claims, and no `alg` negotiation to get wrong — a token that is not HS256 is
 * simply not one of Open WebUI's.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityMode } from "./config.ts";

export const JWT_HEADER = "x-openwebui-user-jwt";
export const USER_ID_HEADER = "x-openwebui-user-id";
export const ISSUER = "open-webui";
/** Tolerated disagreement between Open WebUI's clock and ours. */
const CLOCK_SKEW_SECONDS = 30;

/** Equal-time comparison of two strings of any lengths. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True when the Authorization header carries exactly the configured bearer key. */
export function bearerMatches(authorization: string | undefined, secret: string): boolean {
  if (typeof authorization !== "string") return false;
  // A prefix and a slice, not a regular expression: the header is the network's, and
  // `\s+(.+)` backtracks polynomially on "Bearer" followed by a run of spaces.
  const value = authorization.trim();
  if (value.slice(0, 7).toLowerCase() !== "bearer ") return false;
  const token = value.slice(7).trim();
  return token.length > 0 && sameSecret(token, secret);
}

function base64urlJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export type IdentityVerdict = { owner: string } | { refused: string };

/** The user a signed token names, or why it names nobody. */
export function verifySignedIdentity(token: string, key: string, nowSeconds: number = Date.now() / 1000): IdentityVerdict {
  const parts = token.split(".");
  if (parts.length !== 3) return { refused: "identity token is malformed" };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = base64urlJson(headerPart) as { alg?: unknown } | undefined;
  if (!header || header.alg !== "HS256") return { refused: "identity token is not signed with HS256" };

  const expected = createHmac("sha256", key).update(`${headerPart}.${payloadPart}`).digest();
  const given = Buffer.from(signaturePart, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { refused: "identity token signature does not verify" };
  }

  const payload = base64urlJson(payloadPart) as { sub?: unknown; iss?: unknown; exp?: unknown } | undefined;
  if (!payload) return { refused: "identity token payload is unreadable" };
  if (payload.iss !== ISSUER) return { refused: "identity token was not issued by Open WebUI" };
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return { refused: "identity token has expired" };
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return { refused: "identity token names no user" };
  return { owner: payload.sub };
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

/** The owner of a request whose bearer key has already been checked. */
export function resolveOwner(
  headers: Record<string, string | string[] | undefined>,
  mode: IdentityMode,
  key: string | undefined,
  nowSeconds?: number,
): IdentityVerdict {
  if (mode === "signed") {
    const token = single(headers[JWT_HEADER])?.trim();
    if (!token) return { refused: "no signed identity: Open WebUI must forward users with FORWARD_USER_INFO_HEADER_JWT_SECRET set" };
    return verifySignedIdentity(token, key ?? "", nowSeconds);
  }
  const user = single(headers[USER_ID_HEADER])?.trim();
  if (!user) return { refused: "no user identity: Open WebUI must forward users (ENABLE_FORWARD_USER_INFO_HEADERS)" };
  return { owner: user };
}
