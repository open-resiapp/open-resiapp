// Pure storage-key policy (no server-only deps so scripts/*-check.ts can
// import it). Used by src/lib/storage.ts.

/**
 * Key prefixes whose bytes are access-controlled per row (document library
 * audience/subject, accounting invoices). They must only ever be
 * served through their auth-gated proxy route — never via a signed URL.
 * BYT-20261118-005 (G1).
 */
export const PROXY_ONLY_KEY_PREFIXES = ["documents/", "accounting"] as const;

export function isProxyOnlyKey(key: string): boolean {
  return PROXY_ONLY_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/** Throws for keys that must stay proxy-only (see PROXY_ONLY_KEY_PREFIXES). */
export function assertSignableKey(key: string): void {
  if (isProxyOnlyKey(key)) {
    throw new Error(`Storage key is proxy-only, refusing to sign: ${key}`);
  }
}
