/**
 * BYT-20261118-004 fault-report engine check — `pnpm test:faults`.
 * Self-contained tsx, NO database. Pins:
 *   - the lifecycle table (every from×to pair; withdrawn is reporter-only)
 *   - reason-required transitions
 *   - reporter edit / withdraw gates, assignee conflict, photo limits
 *   - location default visibility + narrow-only rule
 *   - the resident view key set is EXACTLY RESIDENT_VIEW_KEYS (negative:
 *     board-only fields never appear even when the input row carries them)
 *   - every engine error code + category slug has a label in sk/en/cs
 *   - filter parse / cookie round-trip, ISO week key
 */
import { readFileSync } from "fs";
import path from "path";

import { FAULT_CATEGORY_SLUGS } from "@modules/faults/src/engine/catalog";
import {
  EMPTY_FILTERS,
  filtersToParams,
  parseFilterCookie,
  parseFilters,
  serializeFilterCookie,
} from "@modules/faults/src/engine/filters";
import {
  checkAssignee,
  checkBoardTransition,
  checkLocationAllowed,
  checkPhoto,
  checkPhotoCount,
  checkReporterEdit,
  checkReporterVisibility,
  checkWithdraw,
  FAULT_ERROR_CODES,
  FAULT_STATUSES,
  isoWeek,
  type FaultStatus,
} from "@modules/faults/src/engine/transitions";
import { RESIDENT_VIEW_KEYS, toResidentView } from "@modules/faults/src/engine/views";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("lifecycle (all from×to pairs)");
{
  const allowed: Record<FaultStatus, FaultStatus[]> = {
    new: ["in_progress", "resolved", "rejected"],
    in_progress: ["resolved", "rejected", "new"],
    resolved: ["in_progress"],
    rejected: ["new"],
    withdrawn: [],
  };
  for (const from of FAULT_STATUSES) {
    for (const to of FAULT_STATUSES) {
      const r = checkBoardTransition(from, to, "reason");
      const expected = allowed[from].includes(to);
      check(
        `${from} → ${to} ${expected ? "allowed" : "FAULT_INVALID_TRANSITION"}`,
        expected ? r.ok : !r.ok && r.code === "FAULT_INVALID_TRANSITION"
      );
    }
  }
}

console.log("reason required");
{
  const rej = checkBoardTransition("new", "rejected", "  ");
  check("reject without message", !rej.ok && rej.code === "FAULT_REASON_REQUIRED");
  const reopen = checkBoardTransition("resolved", "in_progress", null);
  check("reopen resolved without message", !reopen.ok && reopen.code === "FAULT_REASON_REQUIRED");
  check("resolve without message ok", checkBoardTransition("in_progress", "resolved", null).ok);
  check("rejected → new without message ok", checkBoardTransition("rejected", "new", null).ok);
}

console.log("reporter gates");
{
  check("edit while new + untouched", checkReporterEdit({ status: "new", boardTouched: false }).ok);
  const e1 = checkReporterEdit({ status: "in_progress", boardTouched: true });
  check("edit after status change → FAULT_NOT_EDITABLE", !e1.ok && e1.code === "FAULT_NOT_EDITABLE");
  const e2 = checkReporterEdit({ status: "new", boardTouched: true });
  check("edit after board field change → FAULT_NOT_EDITABLE", !e2.ok && e2.code === "FAULT_NOT_EDITABLE");
  check("withdraw while new + untouched", checkWithdraw({ status: "new", boardTouched: false }).ok);
  const w = checkWithdraw({ status: "new", boardTouched: true });
  check("withdraw after board change → FAULT_WITHDRAW_NOT_ALLOWED", !w.ok && w.code === "FAULT_WITHDRAW_NOT_ALLOWED");
}

console.log("assignee + photos");
{
  const a = checkAssignee({ assigneeUserId: "u", contractorId: "c" });
  check("user + contractor → FAULT_ASSIGNEE_CONFLICT", !a.ok && a.code === "FAULT_ASSIGNEE_CONFLICT");
  check("user only ok", checkAssignee({ assigneeUserId: "u", contractorId: null }).ok);
  check("5 photos ok", checkPhotoCount(0, 5).ok);
  const six = checkPhotoCount(5, 1);
  check("6th photo → FAULT_TOO_MANY_PHOTOS", !six.ok && six.code === "FAULT_TOO_MANY_PHOTOS");
  check("pdf rejected", !checkPhoto({ type: "application/pdf", size: 10 }).ok);
  check("11 MB rejected", !checkPhoto({ type: "image/jpeg", size: 11 * 1024 * 1024 }).ok);
  check("jpeg 1 MB ok", checkPhoto({ type: "image/jpeg", size: 1024 * 1024 }).ok);
}

console.log("location + visibility");
{
  const forged = checkLocationAllowed("x", ["a", "b"]);
  check("forged location → FAULT_LOCATION_NOT_ALLOWED", !forged.ok && forged.code === "FAULT_LOCATION_NOT_ALLOWED");
  const u = checkReporterVisibility("unit", null);
  check("unit default private", u.ok && u.visibility === "private");
  const g = checkReporterVisibility("group", null);
  check("entrance default entrance", g.ok && g.visibility === "entrance");
  const r = checkReporterVisibility("root", null);
  check("root default community", r.ok && r.visibility === "community");
  const narrow = checkReporterVisibility("root", "private");
  check("narrow root → private ok", narrow.ok && narrow.visibility === "private");
  const widen = checkReporterVisibility("unit", "community");
  check("widen unit → community forbidden", !widen.ok && widen.code === "FAULT_VISIBILITY_WIDEN_FORBIDDEN");
  const widen2 = checkReporterVisibility("group", "community");
  check("widen entrance → community forbidden", !widen2.ok && widen2.code === "FAULT_VISIBILITY_WIDEN_FORBIDDEN");
}

console.log("resident view key set (exact)");
{
  const now = new Date();
  // A row that (wrongly) carries board-only columns must not leak them.
  const polluted = {
    id: "f1",
    title: "Výťah stojí",
    description: "d",
    status: "new" as const,
    locationLabel: "Vchod A",
    locationNote: null,
    visibility: "entrance" as const,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    isMine: false,
    priority: "urgent",
    internalNote: "secret",
    assigneeUserId: "u",
    invoiced: true,
    expenseId: "e",
    categoryId: "c",
    reporterId: "r",
  };
  const view = toResidentView(polluted, [{ id: "p1" }], [
    { status: "in_progress", message: "ideme na to", createdAt: now.toISOString() },
  ]);
  const keys = Object.keys(view).sort();
  const expected = [...RESIDENT_VIEW_KEYS].sort();
  check("keys == RESIDENT_VIEW_KEYS", JSON.stringify(keys) === JSON.stringify(expected), keys.join(","));
  check("photos carry only id", JSON.stringify(view.photos) === JSON.stringify([{ id: "p1" }]));
  check(
    "publicEvents carry only status/message/createdAt",
    Object.keys(view.publicEvents[0]).sort().join(",") === "createdAt,message,status"
  );
}

console.log("i18n coverage (sk/en/cs)");
{
  for (const loc of ["sk", "en", "cs"]) {
    const msgs = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages", `${loc}.json`), "utf-8")
    ) as { Faults?: Record<string, Record<string, unknown>> };
    const f = msgs.Faults ?? {};
    const missingErr = FAULT_ERROR_CODES.filter((c) => typeof f.errors?.[c] !== "string");
    check(`${loc}: every error code labelled`, missingErr.length === 0, missingErr.join(","));
    const missingCat = FAULT_CATEGORY_SLUGS.filter((s) => typeof f.category?.[s] !== "string");
    check(`${loc}: every category slug labelled`, missingCat.length === 0, missingCat.join(","));
    const missingStatus = FAULT_STATUSES.filter((s) => typeof f.status?.[s] !== "string");
    check(`${loc}: every status labelled`, missingStatus.length === 0, missingStatus.join(","));
  }
}

console.log("filters");
{
  const f = parseFilters({ stav: "new,in_progress,bogus", priorita: "high", stare: "1", riesi: "none" });
  check("status parsed + bogus dropped", f.status.join(",") === "new,in_progress");
  check("priority/stale/assignee parsed", f.priority === "high" && f.stale && f.assignee === "none");
  const round = parseFilterCookie(serializeFilterCookie(f));
  check("cookie round-trip", JSON.stringify(filtersToParams(round)) === JSON.stringify(filtersToParams(f)));
  check("garbage cookie → empty", JSON.stringify(parseFilterCookie("%%%")) === JSON.stringify(EMPTY_FILTERS));
  check("bad uuid category dropped", parseFilters({ kategoria: "x' OR 1=1" }).categoryId === null);
}

console.log("iso week");
check("2026-11-16 (Mon) → 2026-W47", isoWeek(new Date("2026-11-16T07:00:00Z")) === "2026-W47");
check("2027-01-01 → 2026-W53", isoWeek(new Date("2027-01-01T07:00:00Z")) === "2026-W53");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall fault checks passed");
