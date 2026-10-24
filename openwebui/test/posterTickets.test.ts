import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InvalidPosterTicket, issuePosterSaveTicket, POSTER_SAVE_TICKET_TTL_MS, verifyPosterSaveTicket } from "../src/posterTickets.ts";

const SECRET = "test-bearer-secret";
const NOW = 1_800_000_000_000;
const POSTER = "po_1234567890abcdef";

test("poster save capabilities carry only an owner hash and their poster revision scope", () => {
  const ticket = issuePosterSaveTicket(SECRET, "alice", POSTER, 3, NOW);
  const claims = verifyPosterSaveTicket(SECRET, ticket, NOW + 1);
  assert.deepEqual(claims, {
    ownerHash: createHash("sha256").update("alice").digest("hex"),
    posterId: POSTER,
    baseRevision: 3,
    expiresAt: NOW + POSTER_SAVE_TICKET_TTL_MS,
  });
  assert.doesNotMatch(ticket, /alice/);
});

test("poster save capabilities reject malformed, tampered, wrongly signed and expired tickets", () => {
  const ticket = issuePosterSaveTicket(SECRET, "alice", POSTER, 3, NOW);
  for (const invalid of ["", "not-a-ticket", `${ticket}x`, issuePosterSaveTicket("other-secret", "alice", POSTER, 3, NOW)]) {
    assert.throws(() => verifyPosterSaveTicket(SECRET, invalid, NOW), InvalidPosterTicket);
  }
  assert.throws(() => verifyPosterSaveTicket(SECRET, ticket, NOW + POSTER_SAVE_TICKET_TTL_MS), /invalid or expired/);
});

test("a capability for another poster or base revision remains bound to those claims", () => {
  const ticket = issuePosterSaveTicket(SECRET, "alice", POSTER, 3, NOW);
  assert.throws(() => verifyPosterSaveTicket(SECRET, ticket.slice(0, -1) + (ticket.endsWith("A") ? "B" : "A"), NOW), InvalidPosterTicket);
  const otherPoster = verifyPosterSaveTicket(SECRET, issuePosterSaveTicket(SECRET, "alice", "po_fedcba0987654321", 3, NOW), NOW);
  const otherRevision = verifyPosterSaveTicket(SECRET, issuePosterSaveTicket(SECRET, "alice", POSTER, 4, NOW), NOW);
  assert.notEqual(otherPoster.posterId, POSTER);
  assert.notEqual(otherRevision.baseRevision, 3);
});
