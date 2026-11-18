import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveInternalKey } from "@/lib/signed-token.server";

// BYT-20261118-009 §5: `mod_voting_ballots.signature` for an e-mail-confirmed
// ballot.
//
// An e-mail click gives no owner-held key, so no owner signature is
// possible. This value proves that THIS server's confirm path wrote the
// row for exactly (voting, unit, owner, item commitment, confirmation time,
// confirmation request). Any later DB-level edit of a bound field, or a row
// inserted outside the confirm path, fails `verifyEmailBallotSignature`.
//
// INTERNAL tamper detection only (docs/domain/voting.md: secret-salted
// digests never go into an externally-verifiable artefact). The passkey
// path stores the WebAuthn proof instead, which IS externally verifiable.

const PREFIX = "hmac-sha256:v1:";
const KEY_LABEL = "open-housing/ballot-signature/v1/email";

export interface EmailBallotSignatureInput {
  votingId: string;
  unitId: string;
  ownerId: string;
  ballotHash: string;
  confirmedAt: Date;
  pendingBallotId: string;
}

function canonical(i: EmailBallotSignatureInput): string {
  return [
    "v1",
    "email",
    i.votingId,
    i.unitId,
    i.ownerId,
    i.ballotHash,
    String(i.confirmedAt.getTime()),
    i.pendingBallotId,
  ].join("|");
}

function mac(i: EmailBallotSignatureInput): Buffer {
  return createHmac("sha256", deriveInternalKey(KEY_LABEL)).update(canonical(i), "utf8").digest();
}

export function signEmailBallot(i: EmailBallotSignatureInput): string {
  return PREFIX + mac(i).toString("hex");
}

/** Recompute and compare (constant time). False for any other format. */
export function verifyEmailBallotSignature(
  signature: string | null,
  i: EmailBallotSignatureInput
): boolean {
  if (!signature || !signature.startsWith(PREFIX)) return false;
  const hex = signature.slice(PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  return timingSafeEqual(Buffer.from(hex, "hex"), mac(i));
}
