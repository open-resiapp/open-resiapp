/**
 * BYT-20261118-003 check (run: `pnpm test:owner-health`).
 *
 * No test runner is configured in this repo, so this is a self-contained tsx
 * script (same pattern as voting-golden-check.ts). Exits non-zero on failure.
 *
 * Guards:
 *   1. computeOwnerQueue — one person per condition + healthy owners returns
 *      EXACTLY the expected {code, userId} set (full membership / count, so a
 *      healthy owner producing any item fails); one item per person; old
 *      accounts without last login are not "never_logged_in"; a new
 *      invitation changes the fingerprint.
 *   2. runOwnershipChecks — one fixture per code returns that code only; a
 *      clean community returns []; a correct BSM pair produces no
 *      duplicate_ordinal while the same ordinal on another unit does; units
 *      without LV data never produce BSM / ordinal findings.
 *   3. LV parser keeps lv_ordinal + ownership_form on both BSM spouses.
 *   4. Unit type: getUnitType defaults, ONE aggregated unit_type_unset
 *      finding (exact set), LV byt / nebytový priestor / garáž detection.
 */
import { runOwnershipChecks, type CheckMembership } from "@/lib/owner-checks";
import {
  INVITE_UNFINISHED_AFTER_DAYS,
  LAST_LOGIN_TRACKING_SINCE,
  computeOwnerQueue,
  countBadgeItems,
  type QueuePerson,
} from "@/lib/owner-queue";
import { parseLvText } from "@/lib/import/parsers/lv-paste";
import { getUnitType, isResidentialUnit, isUnitTypeSet } from "@/lib/unit-type";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.parse(LAST_LOGIN_TRACKING_SINCE) + 400 * DAY);
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

function person(id: string, over: Partial<QueuePerson>): QueuePerson {
  return {
    id,
    status: "active",
    deactivated: false,
    email: `${id}@test.sk`,
    flatCount: 1,
    createdAt: iso(30 * DAY),
    invite: null,
    lastLoginAt: iso(1 * DAY),
    ...over,
  };
}

// ── 1. Queue ──────────────────────────────────────────────────────────
console.log("computeOwnerQueue");
{
  const people: QueuePerson[] = [
    person("pending", { status: "pending", createdAt: iso(2 * DAY), lastLoginAt: null }),
    person("noemail", { status: "no_account", email: null, lastLoginAt: null }),
    person("invstale", {
      status: "invited",
      lastLoginAt: null,
      invite: { id: "inv-1", sentAt: iso(10 * DAY), expiresAt: iso(-20 * DAY), expired: false },
    }),
    // Invited without e-mail AND expired → ONE item (invite_unfinished, QR).
    person("invexpqr", {
      status: "invited",
      email: null,
      lastLoginAt: null,
      invite: { id: "inv-2", sentAt: iso(40 * DAY), expiresAt: iso(10 * DAY), expired: true },
    }),
    person("never", { lastLoginAt: null, createdAt: iso(20 * DAY) }),
    person("inactive", { lastLoginAt: iso(400 * DAY) }),
    // Healthy / not-yet-due people — must produce NOTHING.
    person("healthy", {}),
    person("freshinvite", {
      status: "invited",
      lastLoginAt: null,
      invite: { id: "inv-3", sentAt: iso(1 * DAY), expiresAt: iso(-29 * DAY), expired: false },
    }),
    person("newaccount", { lastLoginAt: null, createdAt: iso(3 * DAY) }),
    person("deactivated", { deactivated: true, lastLoginAt: null, createdAt: iso(20 * DAY) }),
    person("noflatshell", { status: "no_account", email: null, flatCount: 0, lastLoginAt: null }),
    person("shellwithemail", { status: "no_account", lastLoginAt: null }),
  ];
  const items = computeOwnerQueue(people, NOW);
  const got = items.map((i) => `${i.code}:${i.userId}`).sort();
  const expected = [
    "registration_pending:pending",
    "missing_email:noemail",
    "invite_unfinished:invstale",
    "invite_unfinished:invexpqr",
    "never_logged_in:never",
    "inactive_long:inactive",
  ].sort();
  check(
    "exact {code,userId} set (no item for healthy people)",
    JSON.stringify(got) === JSON.stringify(expected),
    `got ${JSON.stringify(got)}`
  );
  check("one item per person", new Set(items.map((i) => i.userId)).size === items.length);
  check(
    "priority order (registration first, inactive last)",
    items[0]?.code === "registration_pending" && items[items.length - 1]?.code === "inactive_long"
  );
  const qr = items.find((i) => i.userId === "invexpqr");
  check("expired invite without e-mail → QR resend", qr?.qr === true && qr.expired === true);
  check("badge excludes inactive_long", countBadgeItems(items) === 5);

  // Fingerprint changes with a new invitation.
  const renewed = computeOwnerQueue(
    [
      person("invstale", {
        status: "invited",
        lastLoginAt: null,
        invite: {
          id: "inv-9",
          sentAt: iso((INVITE_UNFINISHED_AFTER_DAYS + 1) * DAY),
          expiresAt: iso(-20 * DAY),
          expired: false,
        },
      }),
    ],
    NOW
  );
  check(
    "new invitation → new fingerprint",
    renewed.length === 1 &&
      renewed[0].fingerprint !== items.find((i) => i.userId === "invstale")?.fingerprint
  );

  // Accounts created before tracking with NULL last login: not never_logged_in.
  const justAfterRelease = new Date(Date.parse(LAST_LOGIN_TRACKING_SINCE) + 30 * DAY);
  const old = computeOwnerQueue(
    [
      person("legacy", {
        lastLoginAt: null,
        createdAt: new Date(Date.parse(LAST_LOGIN_TRACKING_SINCE) - 200 * DAY).toISOString(),
      }),
    ],
    justAfterRelease
  );
  check("pre-tracking account with NULL last login is not flagged", old.length === 0);
}

// ── 2. Ownership checks ───────────────────────────────────────────────
console.log("runOwnershipChecks");
const m = (
  userId: string,
  unitId: string,
  share: [number, number],
  lvOrdinal: number | null = null,
  ownershipForm: string | null = null
): CheckMembership => ({ userId, unitId, shareNum: share[0], shareDen: share[1], lvOrdinal, ownershipForm });

function codes(units: string[], ms: CheckMembership[], lvChecks = true) {
  return runOwnershipChecks(units.map((id) => ({ id })), ms, { lvChecks }).map((f) => f.code);
}
{
  const clean = codes(
    ["u1", "u2"],
    [m("a", "u1", [1, 1], 1), m("b", "u2", [1, 2], 2, "bsm"), m("c", "u2", [1, 2], 2, "bsm")]
  );
  check("clean community → []", clean.length === 0, JSON.stringify(clean));

  const one = (name: string, got: string[], code: string) =>
    check(`${name} → only ${code}`, got.length === 1 && got[0] === code, JSON.stringify(got));

  one("co-owner missing", codes(["u1"], [m("a", "u1", [1, 2])]), "share_sum_mismatch");
  one("no shares set (total 0)", codes(["u1"], [m("a", "u1", [0, 1])]), "share_sum_mismatch");
  one("unit without owner", codes(["u1", "u2"], [m("a", "u1", [1, 1])]), "unit_without_owner");
  one(
    "BSM partner missing",
    codes(["u1"], [m("a", "u1", [1, 2], 5, "bsm"), m("b", "u1", [1, 2], 6)]),
    "bsm_partner_missing"
  );
  one(
    "BSM different shares",
    codes(["u1"], [m("a", "u1", [1, 4], 5, "bsm"), m("b", "u1", [3, 4], 5, "bsm")]),
    "bsm_share_mismatch"
  );
  one(
    "three in one BSM ordinal",
    codes(["u1"], [
      m("a", "u1", [1, 3], 5, "bsm"),
      m("b", "u1", [1, 3], 5, "bsm"),
      m("c", "u1", [1, 3], 5, "bsm"),
    ]),
    "bsm_too_many"
  );
  one(
    "same ordinal on two units",
    codes(["u1", "u2"], [m("a", "u1", [1, 1], 7), m("b", "u2", [1, 1], 7)]),
    "duplicate_ordinal"
  );
  const pairPlusOther = codes(
    ["u1", "u2"],
    [m("a", "u1", [1, 2], 3, "bsm"), m("b", "u1", [1, 2], 3, "bsm"), m("c", "u2", [1, 1], 3)]
  );
  check(
    "BSM pair + same ordinal on another unit → duplicate_ordinal",
    pairPlusOther.length === 1 && pairPlusOther[0] === "duplicate_ordinal",
    JSON.stringify(pairPlusOther)
  );
  const noLvData = codes(["u1"], [m("a", "u1", [1, 2], 5, "bsm"), m("b", "u1", [1, 2], 5)], false);
  check(
    "lvChecks off → no BSM / ordinal findings",
    noLvData.every((c) => c === "share_sum_mismatch" || c === "unit_without_owner"),
    JSON.stringify(noLvData)
  );
  const manual = codes(["u1", "u2"], [m("a", "u1", [1, 1]), m("b", "u2", [1, 1])]);
  check("manual data without ordinals → []", manual.length === 0, JSON.stringify(manual));
  const over = runOwnershipChecks([{ id: "u1" }], [m("a", "u1", [1, 1]), m("b", "u1", [1, 2])], {
    lvChecks: true,
  });
  check("over-allocation direction = over", over[0]?.facts.direction === "over");
}

// ── 3. LV parser keeps ordinal + BSM ──────────────────────────────────
console.log("parseLvText");
{
  const lv = [
    "Vchod (číslo) 1",
    "Poschodie prízemie",
    "Číslo bytu 1",
    "Podiel priestoru na spoločných častiach a spoločných zariadeniach domu a spoluvlastnícky podiel k pozemku 1/96",
    "Súpisné číslo 2514",
    "Spoluvlastnícky podiel",
    "12 Novák Ján a Nováková Mária, Hlavná 1, Poprad, SR, Dátum narodenia: 10.11.1949, Dátum narodenia: 24.02.1958, BSM 1/2",
    "Iné údaje: Bez zápisu",
    "Poznámky: Bez zápisu",
    "13 Horák Peter, Hlavná 2, Poprad, SR, Dátum narodenia: 01.01.1970 1/2",
    "Iné údaje: Bez zápisu",
    "Správca - Neevidovaní",
  ].join("\n");
  const rows = parseLvText(lv);
  const bsm = rows.filter((r) => r.ownership_form === "bsm");
  const sole = rows.filter((r) => r.ownership_form === undefined);
  check(
    "BSM row → two spouses with ordinal 12 and form bsm",
    bsm.length === 2 && bsm.every((r) => r.lv_ordinal === 12),
    JSON.stringify(rows.map((r) => [r.owner_name, r.lv_ordinal, r.ownership_form]))
  );
  check(
    "sole owner keeps ordinal 13 and no form",
    sole.length === 1 && sole[0].lv_ordinal === 13,
    JSON.stringify(sole)
  );
}

// ── 4. Unit type (src/lib/unit-type.ts) ──────────────────────────────
console.log("unit type");
{
  check("absent unit_type reads as flat", getUnitType({}) === "flat" && !isUnitTypeSet({}));
  check("garbage unit_type reads as flat, unset", getUnitType({ unit_type: "x" }) === "flat" && !isUnitTypeSet({ unit_type: "x" }));
  check("garage is set and non-residential", isUnitTypeSet({ unit_type: "garage" }) && !isResidentialUnit({ unit_type: "garage" }));

  const units = [
    { id: "u1", unitTypeSet: true },
    { id: "u2", unitTypeSet: false },
    { id: "u3", unitTypeSet: false },
  ];
  const owned = [m("a", "u1", [1, 1]), m("b", "u2", [1, 1]), m("c", "u3", [1, 1])];
  const on = runOwnershipChecks(units, owned, { lvChecks: false, unitTypeCheck: true });
  check(
    "unset types → EXACTLY one aggregated unit_type_unset finding",
    on.length === 1 && on[0].code === "unit_type_unset" && on[0].facts.count === 2 &&
      on[0].unitIds.join(",") === "u2,u3",
    JSON.stringify(on)
  );
  const off = runOwnershipChecks(units, owned, { lvChecks: false });
  check("unitTypeCheck off → no unit_type_unset", off.length === 0, JSON.stringify(off));
  const allSet = runOwnershipChecks(
    units.map((u) => ({ ...u, unitTypeSet: true })),
    owned,
    { lvChecks: true, unitTypeCheck: true }
  );
  check("all types set → []", allSet.length === 0, JSON.stringify(allSet));

  const owner = (n: number) =>
    `${n} Novák Ján, Hlavná 1, Poprad, SR, Dátum narodenia: 01.01.1970 1/1\nIné údaje: Bez zápisu\nSprávca - Neevidovaní`;
  const lv = [
    "Vchod (číslo) 1",
    "Poschodie prízemie",
    "Číslo bytu 1",
    "Podiel priestoru na spoločných častiach a spoločných zariadeniach domu a spoluvlastnícky podiel k pozemku 1/96",
    "Spoluvlastnícky podiel",
    owner(1),
    "Vchod (číslo) 1",
    "Poschodie prízemie",
    "Číslo nebytového priestoru 1",
    "Druh nebytového priestoru garáž",
    "Podiel priestoru na spoločných častiach a spoločných zariadeniach domu a spoluvlastnícky podiel k pozemku 1/192",
    "Spoluvlastnícky podiel",
    owner(2),
    // NP without its own "Vchod (číslo)" line — must not glue onto NP 1.
    "Poschodie suterén",
    "Číslo nebytového priestoru 2",
    "Druh nebytového priestoru sklad",
    "Podiel priestoru na spoločných častiach a spoločných zariadeniach domu a spoluvlastnícky podiel k pozemku 1/192",
    "Spoluvlastnícky podiel",
    owner(3),
  ].join("\n");
  const rows = parseLvText(lv);
  const got = rows.map((r) => `${r.unit_number}:${r.unit_type}`).join("|");
  check(
    "LV: byt → flat, NP garáž → garage, NP without Vchod → own non_residential unit",
    got === "1:flat|NP 1:garage|NP 2:non_residential",
    got
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll owner-health checks passed");
