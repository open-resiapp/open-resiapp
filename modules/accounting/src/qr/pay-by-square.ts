import "server-only";

import { encode, PaymentOptions, CurrencyCode } from "bysquare/pay";

// PAY by square (SK national payment-QR standard, SBA) — spec §QR code
// generation. Static QR on the monthly predpis PDF pre-fills the owner's
// trvalý príkaz: IBAN + amount + VS. CZ instances use SPAYD instead
// (Phase 6) — this module is SK-only by design, never parametrized per
// country (project rule on legally regulated / format-bound content).

export interface PayBySquareInput {
  iban: string;
  amountCents: number;
  vs: string;
  beneficiaryName: string;
  note?: string;
}

/** Returns the PAY by square payload string (rendered as QR client-side). */
export function payBySquareString(input: PayBySquareInput): string {
  return encode({
    payments: [
      {
        type: PaymentOptions.PaymentOrder,
        amount: input.amountCents / 100,
        bankAccounts: [{ iban: input.iban }],
        currencyCode: CurrencyCode.EUR,
        variableSymbol: input.vs,
        paymentNote: input.note,
        beneficiary: { name: input.beneficiaryName },
      },
    ],
  });
}
