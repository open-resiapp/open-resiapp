/**
 * BYT-20260512-002 electronic-delivery consent check — AC 426
 * (run: `pnpm test:accounting-e-delivery`).
 *
 * Self-contained tsx script — NO database. Guards the pure consent predicate
 * + delivery split in modules/accounting/src/lib/e-delivery.ts.
 */
import {
  hasEDeliveryConsent,
  partitionEDelivery,
} from "@modules/accounting/src/lib/e-delivery";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── consent predicate ──────────────────────────────────
console.log("consent predicate");
{
  check("null row → no consent", hasEDeliveryConsent(null) === false);
  check("no consentAt → no consent", hasEDeliveryConsent({ consentAt: null, withdrawnAt: null }) === false);
  check(
    "consented, not withdrawn → consent",
    hasEDeliveryConsent({ consentAt: new Date(), withdrawnAt: null }) === true
  );
  check(
    "consented then withdrawn → no consent",
    hasEDeliveryConsent({ consentAt: new Date("2026-01-01"), withdrawnAt: new Date("2026-02-01") }) === false
  );
  check(
    "accepts ISO strings",
    hasEDeliveryConsent({ consentAt: "2026-01-01T00:00:00Z", withdrawnAt: null }) === true
  );
}

// ── delivery split ─────────────────────────────────────
console.log("delivery split");
{
  const recipients = [
    { userId: "u1", consented: true },
    { userId: "u2", consented: false },
    { userId: "u3", consented: true },
    { userId: "u4", consented: false },
  ];
  const { eDelivery, postal } = partitionEDelivery(recipients);
  check("e-delivery = consenters only", eDelivery.map((r) => r.userId).join(",") === "u1,u3");
  check("postal = the rest", postal.map((r) => r.userId).join(",") === "u2,u4");
  check("no recipient lost", eDelivery.length + postal.length === recipients.length);

  const allConsent = partitionEDelivery([{ userId: "a", consented: true }]);
  check("all consent → empty postal", allConsent.postal.length === 0 && allConsent.eDelivery.length === 1);
  const noneConsent = partitionEDelivery([{ userId: "a", consented: false }]);
  check("none consent → empty e-delivery", noneConsent.eDelivery.length === 0 && noneConsent.postal.length === 1);
  check("empty input → empty both", partitionEDelivery([]).eDelivery.length === 0);
}

console.log(
  failures === 0
    ? "\nAll e-delivery checks passed."
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
