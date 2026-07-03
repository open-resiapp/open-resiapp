/**
 * BYT-20260512-002 money-helper check
 * (run: `pnpm test:accounting-money`).
 *
 * Self-contained tsx script (same pattern as test:accounting-allocation).
 * Guards modules/accounting/src/lib/money.ts — the ONLY EUR-string ↔ cents
 * conversion in the accounting module. Every money input screen depends on
 * these semantics:
 *   - integer cents only, no float leakage on any input
 *   - comma and dot decimal separators both accepted, spaces ignored
 *   - negatives only with allowNegative, empty only 0 with emptyAsZero
 *   - garbage always null, never NaN or a partial parse
 *   - centsToInput(parseCents(x)) round-trips
 */
import {
  parseCents,
  centsToInput,
  formatEur,
} from "@modules/accounting/src/lib/money";

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("parseCents: happy paths");
check("plain integer", parseCents("12") === 1200);
check("comma decimals", parseCents("12,34") === 1234);
check("dot decimals", parseCents("12.34") === 1234);
check("one decimal digit", parseCents("12,3") === 1230);
check("thousands with space", parseCents("1 234,56") === 123456);
check("multiple spaces", parseCents("1 234 567,89") === 123456789);
check("zero", parseCents("0") === 0);
check("zero with decimals", parseCents("0,00") === 0);

console.log("parseCents: rejection");
check("empty is null by default", parseCents("") === null);
check("whitespace-only is null", parseCents("   ") === null);
check("garbage is null", parseCents("abc") === null);
check("mixed garbage is null", parseCents("12abc") === null);
check("three decimals rejected", parseCents("1,234") === null);
check("double separator rejected", parseCents("1,2,3") === null);
check("lone minus rejected", parseCents("-") === null);
check("negative rejected by default", parseCents("-5") === null);
check("plus sign rejected", parseCents("+5") === null);

console.log("parseCents: options");
check(
  "allowNegative accepts minus",
  parseCents("-12,50", { allowNegative: true }) === -1250
);
check(
  "allowNegative negative zero is zero",
  parseCents("-0", { allowNegative: true }) === 0
);
check(
  "emptyAsZero maps empty to 0",
  parseCents("", { emptyAsZero: true }) === 0
);
check(
  "emptyAsZero maps whitespace to 0",
  parseCents("  ", { emptyAsZero: true }) === 0
);
check(
  "emptyAsZero still rejects garbage",
  parseCents("x", { emptyAsZero: true }) === null
);

console.log("parseCents: integer-cents guarantee (no float leakage)");
{
  // Classic float trap: 0.1 + 0.2. String-based parsing must be exact.
  check("0,10 is exactly 10", parseCents("0,10") === 10);
  check("0,29 is exactly 29", parseCents("0,29") === 29);
  check("19,99 is exactly 1999", parseCents("19,99") === 1999);
  let ok = true;
  for (let cents = 0; cents <= 10000; cents++) {
    const s = (cents / 100).toFixed(2).replace(".", ",");
    if (parseCents(s) !== cents) {
      ok = false;
      console.error(`    mismatch at ${s} → ${parseCents(s)} != ${cents}`);
      break;
    }
  }
  check("0.00-100.00 sweep parses exactly", ok);
}

console.log("centsToInput: round-trip");
check("null → empty", centsToInput(null) === "");
check("0 → 0,00", centsToInput(0) === "0,00");
check("1234 → 12,34", centsToInput(1234) === "12,34");
check("1230 → 12,30", centsToInput(1230) === "12,30");
{
  let ok = true;
  for (const cents of [1, 99, 100, 999, 12345, 100000, 987654321]) {
    if (parseCents(centsToInput(cents)) !== cents) {
      ok = false;
      console.error(`    round-trip failed for ${cents}`);
    }
  }
  check("parseCents(centsToInput(x)) round-trips", ok);
}

console.log("formatEur: sanity");
{
  const s = formatEur(123456);
  check("contains amount", s.includes("1") && s.includes("234,56"), s);
  check("contains € symbol", s.includes("€"), s);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll money checks passed.");
