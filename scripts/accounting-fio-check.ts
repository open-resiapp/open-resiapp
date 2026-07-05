/**
 * BYT-20260512-002 Phase 2 — Fio mapper check
 * (run: `pnpm test:accounting-fio`).
 *
 * Pure-function tests against a mocked Fio JSON payload — no network,
 * no credentials, ever. Guards:
 *   - column mapping (ID pohybu → fio:{id} idempotency key, VS/ŠS/KS
 *     zero-strip, signed Objem → direction + absolute cents)
 *   - URL construction (token embedded, period bounds)
 *   - malformed payloads throw, never silently import nothing
 */
import {
  mapFioTransactions,
  fioAmountToCents,
  fioTransactionsUrl,
  type FioStatementJson,
} from "@modules/accounting/src/lib/fio-format";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("fioAmountToCents");
check("positive decimal", fioAmountToCents("120.5") === 12050);
check("negative", fioAmountToCents("-20.00") === -2000);
check("integer", fioAmountToCents(87) === 8700);
try {
  fioAmountToCents("12,50");
  failures++;
  console.error("  FAIL comma amount — did not throw");
} catch {
  console.log("  ok  comma amount throws");
}

console.log("fioTransactionsUrl");
{
  const url = fioTransactionsUrl("tokenABC123", "2026-06-01", "2026-07-04");
  check(
    "shape",
    url ===
      "https://fioapi.fio.cz/v1/rest/periods/tokenABC123/2026-06-01/2026-07-04/transactions.json"
  );
  check(
    "token is uri-encoded",
    fioTransactionsUrl("a/b", "2026-01-01", "2026-01-02").includes("a%2Fb")
  );
}

console.log("mapFioTransactions — mocked payload");
{
  const payload: FioStatementJson = {
    accountStatement: {
      info: { currency: "EUR", iban: "SK9611000000002918599669" },
      transactionList: {
        transaction: [
          {
            column22: { value: 26479501234 },
            column0: { value: "2026-07-02+0200" },
            column1: { value: 120.5 },
            column2: { value: "2918599111" },
            column3: { value: "1100" },
            column4: { value: "0308" },
            column5: { value: "0000000101" },
            column6: { value: "0" },
            column10: { value: "Ján Mrkvička" },
            column14: { value: "EUR" },
            column16: { value: "Predpis 2026-07" },
          },
          {
            column22: { value: 26479501235 },
            column0: { value: "2026-07-02+0200" },
            column1: { value: -20 },
            column10: { value: "Slovenská pošta" },
          },
        ],
      },
    },
  };
  const { currency, lines } = mapFioTransactions(payload);
  check("currency from info", currency === "EUR");
  check("2 lines", lines.length === 2);

  const [credit, debit] = lines;
  check("idempotency key fio:{id}", credit.externalTxId === "fio:26479501234");
  check("credit direction + abs cents", credit.direction === "credit" && credit.amountCents === 12050);
  check("VS zero-stripped", credit.vs === "101");
  check("zero SS is null", credit.ss === null);
  check("KS zero-stripped", credit.ks === "308");
  check("booking date trimmed", credit.bookingDate === "2026-07-02");
  check(
    "counterparty account/bank pair",
    credit.counterpartyIban === "2918599111/1100"
  );
  check("counterparty name", credit.counterpartyName === "Ján Mrkvička");
  check("narrative from column16", credit.narrative === "Predpis 2026-07");

  check("debit direction", debit.direction === "debit" && debit.amountCents === 2000);
  check("debit key", debit.externalTxId === "fio:26479501235");
}

console.log("malformed payloads");
try {
  mapFioTransactions({} as FioStatementJson);
  failures++;
  console.error("  FAIL empty payload — did not throw");
} catch {
  console.log("  ok  empty payload throws");
}
try {
  mapFioTransactions({
    accountStatement: {
      transactionList: { transaction: [{ column1: { value: 5 } }] },
    },
  });
  failures++;
  console.error("  FAIL missing ID pohybu — did not throw");
} catch {
  console.log("  ok  missing ID pohybu throws");
}
{
  const empty = mapFioTransactions({
    accountStatement: { info: { currency: "EUR" }, transactionList: {} },
  });
  check("no transactions → empty list", empty.lines.length === 0);
}

// ── supplier lookup mappers (pure, mocked payloads) ────

import {
  mapAresSubject,
  mapFinstatDetail,
  normalizeIco,
  aresSubjectUrl,
} from "@modules/accounting/src/lib/supplier-lookup-format";

console.log("supplier lookup — normalizeIco");
check("8 digits pass", normalizeIco("36631124") === "36631124");
check("6 digits zero-pad", normalizeIco("123456") === "00123456");
check("spaces stripped", normalizeIco("36 631 124") === "36631124");
check("letters rejected", normalizeIco("ABC123") === null);
check("too long rejected", normalizeIco("123456789") === null);

console.log("supplier lookup — FinStat mapper");
{
  const hit = mapFinstatDetail("36631124", {
    Ico: "36631124",
    Name: "Východoslovenská energetika a.s.",
    Street: "Mlynská",
    StreetNumber: "31",
    ZipCode: "042 91",
    City: "Košice",
    Dic: "2022189155",
    IcDphAdditional: "SK2022189155",
    PaymentOrderWarning: false,
    DebtWarning: true,
  });
  check("finstat found", hit.found && hit.name === "Východoslovenská energetika a.s.");
  check("finstat address joined", hit.address === "Mlynská 31, 042 91 Košice");
  check("finstat vat payer", hit.vatPayer === true && hit.icDph === "SK2022189155");
  check("finstat debt flag", hit.debtFlag === true);
  const miss = mapFinstatDetail("00000000", null);
  check("finstat miss", !miss.found && miss.debtFlag === null);
}

console.log("supplier lookup — ARES mapper");
{
  const hit = mapAresSubject("19011918", {
    ico: "19011918",
    obchodniJmeno: "ČEZ Prodej, a.s.",
    dic: "CZ19011918",
    sidlo: { textovaAdresa: "Duhová 425/1, 140 00 Praha 4" },
  });
  check("ares found", hit.found && hit.name === "ČEZ Prodej, a.s.");
  check("ares dic → vat payer", hit.vatPayer === true);
  check("ares debt flag unknown (Phase 6)", hit.debtFlag === null);
  const miss = mapAresSubject("19011918", null);
  check("ares miss", !miss.found);
  check(
    "ares url shape",
    aresSubjectUrl("19011918") ===
      "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/19011918"
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll Fio checks passed.");
