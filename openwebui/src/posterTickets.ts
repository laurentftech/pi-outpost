/** Short-lived, write-only poster capabilities carried by saved Open WebUI embeds. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const OWNER_HASH = /^[a-f0-9]{64}$/;
const POSTER_ID = /^po_[A-Za-z0-9_-]{16}$/;
export const POSTER_SAVE_TICKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PosterSaveClaims {
  ownerHash: string;
  posterId: string;
  baseRevision: number;
  expiresAt: number;
}

export class InvalidPosterTicket extends Error {}

function signingKey(secret: string): Buffer {
  return createHash("sha256").update("pi-outpost/openwebui/poster-save/v1\0").update(secret).digest();
}

export function issuePosterSaveTicket(
  secret: string,
  owner: string,
  posterId: string,
  baseRevision: number,
  now: number = Date.now(),
): string {
  return issuePosterSaveTicketForOwnerHash(secret, createHash("sha256").update(owner).digest("hex"), posterId, baseRevision, now);
}

export function issuePosterSaveTicketForOwnerHash(
  secret: string,
  ownerHash: string,
  posterId: string,
  baseRevision: number,
  now: number = Date.now(),
): string {
  if (!OWNER_HASH.test(ownerHash) || !POSTER_ID.test(posterId) || !Number.isInteger(baseRevision) || baseRevision < 1) {
    throw new InvalidPosterTicket("invalid save capability scope");
  }
  const claims: PosterSaveClaims = {
    ownerHash,
    posterId,
    baseRevision,
    expiresAt: now + POSTER_SAVE_TICKET_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyPosterSaveTicket(secret: string, ticket: string, now: number = Date.now()): PosterSaveClaims {
  if (typeof ticket !== "string" || ticket.length > 2048) throw new InvalidPosterTicket("invalid save capability");
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new InvalidPosterTicket("invalid save capability");
  const [payload, signature] = parts as [string, string];
  const expected = createHmac("sha256", signingKey(secret)).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    throw new InvalidPosterTicket("invalid save capability");
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InvalidPosterTicket("invalid save capability");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new InvalidPosterTicket("invalid save capability");
  }
  if (!claims || typeof claims !== "object") throw new InvalidPosterTicket("invalid save capability");
  const candidate = claims as Partial<PosterSaveClaims>;
  if (
    typeof candidate.ownerHash !== "string" || !OWNER_HASH.test(candidate.ownerHash) ||
    typeof candidate.posterId !== "string" || !POSTER_ID.test(candidate.posterId) ||
    !Number.isInteger(candidate.baseRevision) || (candidate.baseRevision ?? 0) < 1 ||
    !Number.isSafeInteger(candidate.expiresAt) || (candidate.expiresAt ?? 0) <= now
  ) throw new InvalidPosterTicket("invalid or expired save capability");
  return candidate as PosterSaveClaims;
}
