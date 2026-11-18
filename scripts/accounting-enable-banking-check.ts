/**
 * BYT-20261118-001 — Enable Banking mapper + JWT check
 * (run: `pnpm test:accounting-enable-banking`).
 *
 * Pure-function tests against mocked Enable Banking payloads — no network,
 * no credentials. Guards:
 *   - booked-only import (PDNG never imported)
 *   - direction from credit_debit_indicator, sign fallback, exact cents
 *   - id: transaction_id → entry_reference → stable synthetic key
 *   - VS from SBA slash notation and free-text remittance
 *   - counterparty side (debtor on credits, creditor on debits)
 *   - session account shapes, account auto-pick, consent cap, psu_type
 *   - JWT header/claims shape and a valid RS256 signature
 */
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  consentValidUntil,
  ebAmountToCents,
  ebSymbols,
  isEnableBankingErrorCode,
  mapEnableBankingTransactions,
  mapSessionAccounts,
  maskIban,
  pickAccountUid,
  pickPsuType,
  EnableBankingError,
  type EbTransaction,
} from "@modules/accounting/src/lib/enable-banking-format";
import { signEnableBankingJwt } from "@modules/accounting/src/lib/enable-banking-jwt";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function throwsCode(name: string, fn: () => unknown, code: string) {
  try {
    fn();
    failures++;
    console.error(`  FAIL ${name} — did not throw`);
  } catch (err) {
    check(
      name,
      err instanceof EnableBankingError && err.code === code,
      String(err)
    );
  }
}

console.log("ebAmountToCents");
check("decimal string", ebAmountToCents("120.5") === 12050);
check("two decimals", ebAmountToCents("0.07") === 7);
check("negative", ebAmountToCents("-20.00") === -2000);
check("number", ebAmountToCents(87) === 8700);
throwsCode("comma throws", () => ebAmountToCents("12,50"), "EB_INVALID_AMOUNT");
throwsCode("three decimals throw", () => ebAmountToCents("1.234"), "EB_INVALID_AMOUNT");
throwsCode("missing throws", () => ebAmountToCents(undefined), "EB_INVALID_AMOUNT");

console.log("ebSymbols");
{
  const sba = ebSymbols({
    reference_number: "/VS0000000101/SS0000000000/KS0308",
  });
  check("SBA notation in reference_number", sba.vs === "101" && sba.ss === null && sba.ks === "308", JSON.stringify(sba));
  const inRemit = ebSymbols({
    remittance_information: ["Platba za byt", "/VS202/SS/KS"],
  });
  check("SBA notation in remittance line", inRemit.vs === "202", JSON.stringify(inRemit));
  const free = ebSymbols({ remittance_information: ["Fond oprav VS: 0000303 jun"] });
  check("free-text VS", free.vs === "303", JSON.stringify(free));
  const none = ebSymbols({ remittance_information: ["Najom jun"] });
  check("no VS", none.vs === null);
  const noFalseHit = ebSymbols({ remittance_information: ["DEVS12345 order"] });
  check("VS inside a word is not a symbol", noFalseHit.vs === null, JSON.stringify(noFalseHit));
}

console.log("mapEnableBankingTransactions");
{
  const txs: EbTransaction[] = [
    {
      transaction_id: "T-1",
      entry_reference: "E-1",
      transaction_amount: { amount: "120.50", currency: "EUR" },
      credit_debit_indicator: "CRDT",
      status: "BOOK",
      booking_date: "2026-11-02",
      value_date: "2026-11-03",
      debtor: { name: "Ján Mrkvička" },
      debtor_account: { iban: "SK31 1200 0000 1987 4263 7541" },
      creditor: { name: "SVB Dunaj" },
      creditor_account: { iban: "SK9611000000002918599669" },
      reference_number: "/VS0000000101/SS/KS0308",
      remittance_information: ["Zaloha 11/2026"],
    },
    {
      entry_reference: "E-2",
      transaction_amount: { amount: "45.00", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      status: "BOOK",
      booking_date: "2026-11-04",
      debtor_account: { iban: "SK9611000000002918599669" },
      creditor: { name: "Výťahy s.r.o." },
      creditor_account: { iban: "SK0809000000000123123123" },
      remittance_information: ["Servis vytahu"],
    },
    {
      transaction_id: "T-3",
      transaction_amount: { amount: "99.00", currency: "EUR" },
      credit_debit_indicator: "CRDT",
      status: "PDNG",
      booking_date: "2026-11-05",
    },
    {
      // No ids, no indicator — signed amount decides direction.
      transaction_amount: { amount: "-3.20", currency: "EUR" },
      booking_date: "2026-11-06",
      remittance_information: ["Poplatok za vedenie uctu"],
    },
  ];
  const lines = mapEnableBankingTransactions(txs);
  check("pending skipped", lines.length === 3, `got ${lines.length}`);
  const [a, b, c] = lines;
  check("transaction_id wins over entry_reference", a.externalTxId === "eb:T-1");
  check("credit direction + cents", a.direction === "credit" && a.amountCents === 12050);
  check("credit counterparty = debtor, IBAN normalized",
    a.counterpartyName === "Ján Mrkvička" && a.counterpartyIban === "SK3112000000198742637541",
    `${a.counterpartyName} ${a.counterpartyIban}`);
  check("VS/KS from reference_number", a.vs === "101" && a.ks === "308");
  check("dates", a.bookingDate === "2026-11-02" && a.valueDate === "2026-11-03");
  check("narrative from remittance", a.narrative === "Zaloha 11/2026");
  check("currency carried", a.currency === "EUR");
  check("entry_reference fallback", b.externalTxId === "eb:E-2");
  check("debit counterparty = creditor", b.direction === "debit" && b.counterpartyName === "Výťahy s.r.o.");
  check("valueDate falls back to bookingDate", b.valueDate === "2026-11-04");
  check("sign fallback → debit, absolute cents", c.direction === "debit" && c.amountCents === 320);
  check("synthetic id when bank gives none", /^eb:h:[0-9a-f]{8}$/.test(c.externalTxId), c.externalTxId);
  const again = mapEnableBankingTransactions([txs[3]]);
  check("synthetic id is stable", again[0].externalTxId === c.externalTxId);
  const missingStatus = mapEnableBankingTransactions([{ ...txs[0], status: undefined }]);
  check("missing status treated as booked", missingStatus.length === 1);
  throwsCode("bad amount throws, never silently skips",
    () => mapEnableBankingTransactions([{ ...txs[0], transaction_amount: { amount: "1,00" } }]),
    "EB_INVALID_AMOUNT");
}

console.log("mapSessionAccounts / pickAccountUid");
{
  const objects = mapSessionAccounts({
    session_id: "s",
    accounts: [
      { uid: "u1", account_id: { iban: "SK96 1100 0000 0029 1859 9669" }, name: "Bežný", currency: "EUR" },
      { uid: "u2", account_id: { iban: "SK0809000000000123123123" }, name: "Fond", currency: "EUR" },
    ],
  });
  check("object shape", objects.length === 2 && objects[0].iban === "SK9611000000002918599669");
  const uids = mapSessionAccounts({
    session_id: "s",
    accounts: ["u9"],
    accounts_data: [{ uid: "u9", account_id: { iban: "SK0809000000000123123123" } }],
  });
  check("uid + accounts_data shape", uids.length === 1 && uids[0].iban === "SK0809000000000123123123");
  check("pick by dom IBAN", pickAccountUid(objects, "SK96 1100 0000 0029 1859 9669") === "u1");
  check("several, no match → null", pickAccountUid(objects, "SK0000000000000000000000") === null);
  check("several, no dom IBAN → null", pickAccountUid(objects, null) === null);
  check("single → that one", pickAccountUid(uids, null) === "u9");
  check("single, same IBAN spaced → that one", pickAccountUid(uids, "sk08 0900 0000 0001 2312 3123") === "u9");
  check("single, different known IBAN → null", pickAccountUid(uids, "SK0000000000000000000000") === null);
  check("none → null", pickAccountUid([], null) === null);
}

console.log("consent / psu / mask / codes");
{
  const now = new Date("2026-11-18T10:00:00Z");
  const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86400000);
  check("capped at 180 days", days(consentValidUntil(now, 400 * 86400)) === 180);
  check("bank maximum below cap", days(consentValidUntil(now, 90 * 86400)) === 90);
  check("missing maximum → 180", days(consentValidUntil(now, null)) === 180);
  check("business preferred", pickPsuType({ name: "x", country: "SK", psu_types: ["personal", "business"] }) === "business");
  check("personal-only bank", pickPsuType({ name: "x", country: "SK", psu_types: ["personal"] }) === "personal");
  check("mask", maskIban("SK9611000000002918599669") === "SK96 •••• 9669");
  check("known code", isEnableBankingErrorCode("EB_CONSENT_EXPIRED"));
  check("unknown code", !isEnableBankingErrorCode("accounting: boom"));
}

console.log("signEnableBankingJwt");
{
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const now = new Date("2026-11-18T10:00:00Z");
  const jwt = signEnableBankingJwt({ appId: "app-123", privateKey }, now);
  const [h, b, sig] = jwt.split(".");
  const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  const header = decode(h);
  const body = decode(b);
  check("header", header.alg === "RS256" && header.typ === "JWT" && header.kid === "app-123");
  check("claims", body.iss === "enablebanking.com" && body.aud === "api.enablebanking.com");
  check("iat/exp ≤ 24h", body.iat === 1794996000 && body.exp > body.iat && body.exp - body.iat <= 86400);
  check("base64url (no padding)", !jwt.includes("=") && !jwt.includes("+") && !jwt.includes("/"));
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h}.${b}`);
  verifier.end();
  check("signature verifies", verifier.verify(publicKey, Buffer.from(sig, "base64url")));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall Enable Banking checks passed");
