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
import {
  isValidIban,
  normalizeIban,
} from "@modules/accounting/src/lib/iban";

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

console.log("iban: normalization");
check(
  "spaces stripped + uppercased",
  normalizeIban("sk96 1100 0000 0029 1859 9669") === "SK9611000000002918599669"
);
check("garbage shape rejected", normalizeIban("XX12") === null);
check("non-alnum rejected", normalizeIban("SK96-1100") === null);

console.log("iban: MOD-97 validation");
// Known-valid IBANs (published examples).
check("valid SK", isValidIban("SK9611000000002918599669"));
check("valid SK with spaces", isValidIban("SK96 1100 0000 0029 1859 9669"));
check("valid CZ", isValidIban("CZ6508000000192000145399"));
check("valid DE", isValidIban("DE89370400440532013000"));
check("valid GB", isValidIban("GB29NWBK60161331926819"));
// Single-digit corruption must fail the checksum.
check("checksum catches digit flip", !isValidIban("SK9611000000002918599668"));
check("checksum catches swapped chars", !isValidIban("SK6911000000002918599669"));
check("empty invalid", !isValidIban(""));
check("too short invalid", !isValidIban("SK96"));

// ── signed-export integrity (pure) ─────────────────────

import {
  buildIntegrity,
  verifyIntegrity,
} from "@modules/accounting/src/lib/export-format";

console.log("export integrity");
{
  const payload = JSON.stringify({ a: 1, b: [2, 3], c: "x" });
  const secret = "test-secret";
  const integrity = buildIntegrity(payload, secret);
  check("verifies own output", verifyIntegrity(payload, integrity, secret).valid);

  const tampered = verifyIntegrity(
    JSON.stringify({ a: 1, b: [2, 3], c: "y" }),
    integrity,
    secret
  );
  check(
    "tampered payload rejected",
    !tampered.valid && tampered.reason === "sha256_mismatch"
  );

  // Attacker recomputes sha256 for the edited payload but cannot forge
  // the HMAC without the server secret.
  const editedPayload = JSON.stringify({ a: 999 });
  const forged = buildIntegrity(editedPayload, "wrong-secret");
  const forgedResult = verifyIntegrity(editedPayload, forged, secret);
  check(
    "forged hmac rejected",
    !forgedResult.valid && forgedResult.reason === "hmac_mismatch"
  );

  const badKey = verifyIntegrity(
    payload,
    { ...integrity, keyId: "other-v9" },
    secret
  );
  check("unknown key id rejected", !badKey.valid && badKey.reason === "unknown_key");

  // JSON round-trip stability — the property the design relies on.
  const roundTripped = JSON.stringify(JSON.parse(payload));
  check("stringify∘parse round-trip is stable", roundTripped === payload);
}

// ── SPAYD (CZ QR Platba, Phase 6 prep) ─────────────────

import { spaydString } from "@modules/accounting/src/qr/spayd";

console.log("SPAYD");
{
  check(
    "canonical shape",
    spaydString({
      iban: "CZ65 0800 0000 1920 0014 5399",
      amountCents: 318000,
      vs: "205",
    }) === "SPD*1.0*ACC:CZ6508000000192000145399*AM:3180.00*CC:CZK*X-VS:205"
  );
  check(
    "sub-koruna cents",
    spaydString({ iban: "CZ6508000000192000145399", amountCents: 105 }) ===
      "SPD*1.0*ACC:CZ6508000000192000145399*AM:1.05*CC:CZK"
  );
  check(
    "message diacritics-stripped + star-escaped",
    spaydString({
      iban: "CZ6508000000192000145399",
      amountCents: 100,
      message: "Vyúčtování *2025*",
    }).endsWith("MSG:Vyuctovani %2A2025%2A")
  );
  for (const bad of [
    () => spaydString({ iban: "XX", amountCents: 100 }),
    () => spaydString({ iban: "CZ6508000000192000145399", amountCents: 0 }),
    () =>
      spaydString({
        iban: "CZ6508000000192000145399",
        amountCents: 100,
        vs: "abc",
      }),
  ]) {
    try {
      bad();
      failures++;
      console.error("  FAIL SPAYD rejection — did not throw");
    } catch {
      console.log("  ok  SPAYD rejects invalid input");
    }
  }
}

// ── revisions .ics builder (pure) ──────────────────────

import {
  buildRevisionsIcs,
  statusFor,
} from "@modules/accounting/src/lib/revisions-format";

console.log("revisions ics");
{
  const ics = buildRevisionsIcs(
    [
      {
        categorySlug: "REVIZIA_GAS",
        supplierName: "Plyn, s.r.o.",
        lastInspectionDate: "2023-05-10T00:00:00.000Z",
        nextDueAt: "2026-05-10T00:00:00.000Z",
        daysUntilDue: 300,
        status: "ok",
      },
    ],
    "SVB Demo, Hlavná 1",
    (slug) => (slug === "REVIZIA_GAS" ? "Revízia plynu" : slug)
  );
  check("ics has calendar envelope", ics.startsWith("BEGIN:VCALENDAR"));
  check("ics has all-day date", ics.includes("DTSTART;VALUE=DATE:20260510"));
  check("ics has stable uid", ics.includes("UID:revizia-REVIZIA_GAS-20260510@open-resiapp"));
  check("ics uses CRLF", ics.includes("\r\n"));
  check(
    "ics escapes commas in summary",
    ics.includes("SUMMARY:Revízia plynu — SVB Demo\\, Hlavná 1")
  );

  check("statusFor overdue", statusFor(-1) === "overdue");
  check("statusFor due_soon boundary", statusFor(60) === "due_soon");
  check("statusFor ok", statusFor(61) === "ok");

  const empty = buildRevisionsIcs([], "Dom", (s) => s);
  check(
    "empty ics still a valid calendar",
    empty.startsWith("BEGIN:VCALENDAR") && empty.includes("END:VCALENDAR")
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll money checks passed.");
