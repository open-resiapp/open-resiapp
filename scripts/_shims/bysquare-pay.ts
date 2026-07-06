// Test-only shim for bysquare/pay (its transitive lzma1 dep has a broken
// exports map under tsx; Next's bundler resolves it fine). e2e does not
// assert on real QR bytes.
export const PaymentOptions = { PaymentOrder: 1 } as const;
export const CurrencyCode = { EUR: "EUR", CZK: "CZK" } as const;
export function encode(): string {
  return "SPD*STUB";
}
export function validateBankAccount(): void {
  /* accept everything in tests */
}
