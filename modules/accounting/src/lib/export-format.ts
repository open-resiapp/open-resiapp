// Signed-export integrity helpers (BYT-20260512-002 Phase 8) — PURE
// module (node crypto only, no server imports) so the golden checks can
// exercise it directly.
//
// Design (decision 2026-07-06, documented in WORK_LOG):
//   bundle = { payload, integrity: { sha256, hmac, keyId } }
//   sha256 = SHA-256 of JSON.stringify(payload)  — detects corruption
//   hmac   = HMAC-SHA256(key, sha256)            — detects tampering
// The key derives from the server secret (NEXTAUTH_SECRET) with a
// versioned context string, so the app itself can verify a bundle years
// later WITHOUT database access — the kontrolná komisia uploads the file
// and the server attests it is byte-identical to what it once produced.
// JSON.stringify is deterministic for parse(stringify(x)) round-trips
// (insertion order preserved), which is the only equality we rely on.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const EXPORT_KEY_CONTEXT = "accounting-export-v1";

export function payloadSha256(payloadJson: string): string {
  return createHash("sha256").update(payloadJson, "utf8").digest("hex");
}

export function deriveExportKey(serverSecret: string): Buffer {
  return createHmac("sha256", serverSecret)
    .update(EXPORT_KEY_CONTEXT)
    .digest();
}

export function signSha256(sha256Hex: string, key: Buffer): string {
  return createHmac("sha256", key).update(sha256Hex).digest("hex");
}

export interface ExportIntegrity {
  sha256: string;
  hmac: string;
  keyId: string;
}

export function buildIntegrity(
  payloadJson: string,
  serverSecret: string
): ExportIntegrity {
  const sha256 = payloadSha256(payloadJson);
  const key = deriveExportKey(serverSecret);
  return {
    sha256,
    hmac: signSha256(sha256, key),
    keyId: EXPORT_KEY_CONTEXT,
  };
}

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: "sha256_mismatch" | "hmac_mismatch" | "unknown_key" };

export function verifyIntegrity(
  payloadJson: string,
  integrity: ExportIntegrity,
  serverSecret: string
): VerifyResult {
  if (integrity.keyId !== EXPORT_KEY_CONTEXT) {
    return { valid: false, reason: "unknown_key" };
  }
  const sha256 = payloadSha256(payloadJson);
  if (sha256 !== integrity.sha256) {
    return { valid: false, reason: "sha256_mismatch" };
  }
  const expected = signSha256(sha256, deriveExportKey(serverSecret));
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(integrity.hmac, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "hmac_mismatch" };
  }
  return { valid: true };
}
