/**
 * BYT-20260512-002 SK debtor name-disclosure check — AC 425
 * (run: `pnpm test:accounting-debtor-disclosure`).
 *
 * Self-contained tsx script — NO database. Guards the pure §9 ods. 3
 * boundary rule in modules/accounting/src/lib/debtor-disclosure.ts.
 */
import {
  discloseDebtorName,
  SK_DEBTOR_NAME_THRESHOLD_CENTS,
} from "@modules/accounting/src/lib/debtor-disclosure";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("§9 ods. 3 threshold = 500 €");
check("threshold is 50000 cents", SK_DEBTOR_NAME_THRESHOLD_CENTS === 50000);

console.log("boundary (SK, toggle on)");
check(
  "499,99 € → name hidden",
  discloseDebtorName({ namesEnabled: true, country: "sk", balanceCents: 49999 }) === false
);
check(
  "500,00 € → name shown",
  discloseDebtorName({ namesEnabled: true, country: "sk", balanceCents: 50000 }) === true
);
check(
  "1000 € → name shown",
  discloseDebtorName({ namesEnabled: true, country: "sk", balanceCents: 100000 }) === true
);

console.log("toggle off strips names regardless of amount");
check(
  "toggle off, 5000 € → hidden",
  discloseDebtorName({ namesEnabled: false, country: "sk", balanceCents: 500000 }) === false
);

console.log("CZ has no statutory basis → always hidden");
check(
  "CZ, toggle on, 5000 € → hidden",
  discloseDebtorName({ namesEnabled: true, country: "cz", balanceCents: 500000 }) === false
);

console.log("non-debtor / credit balances");
check(
  "zero balance → hidden",
  discloseDebtorName({ namesEnabled: true, country: "sk", balanceCents: 0 }) === false
);
check(
  "credit (negative) → hidden",
  discloseDebtorName({ namesEnabled: true, country: "sk", balanceCents: -60000 }) === false
);

console.log(
  failures === 0
    ? "\nAll debtor-disclosure checks passed."
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
