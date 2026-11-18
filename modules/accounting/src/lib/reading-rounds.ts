import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { entities, memberships } from "@/db/schema";
import {
  accountingPeriods,
  auditLog,
  buildingMeterReadings,
  meterReadings,
  personMonths,
  readingRounds,
  unitPersons,
  unitSettings,
} from "../db/schema";
import type { Tx } from "../engine/booking";
import { hasBoardRole } from "./authz";
import { domUnitsWhere, listDomUnits } from "./dom-units";
import { insertReadingTx, voidReadingTx } from "./meters";
import {
  assertReadingYearOpen,
  isReadingYearLocked,
  utcYear,
} from "./reading-lock";
import {
  ROUND_METER_TYPES,
  ReadingError,
  collapsePersonMonths,
  expandPersonRanges,
  readingPhotoUrl,
  validatePersonRanges,
  type MeterType,
  type OwnerReadingEntry,
  type OwnerReadingsView,
  type PersonRange,
} from "./reading-rounds-format";

// Reading rounds — "Zber odpočtov a osôb" (BYT-20261118-006).
//
// Owner-editable = not voided AND not resolved AND round open for owner
// input AND year not locked AND the owner created the row. The owner view
// carries only `canEdit` — never resolvedAt/resolvedById — so "resolved by
// the board" is indistinguishable from "deadline passed" (decision
// 2026-11-18). The board side is a single table per round; the missing list
// is a client-side filter of it, and also feeds the reminder cron.
//
// Hand-off to vyúčtovanie is read-only: meter rows are the same
// mod_accounting_meter_readings rows buildMeteredCostShares already reads;
// person-months reach unit_persons only via the manual board action
// applyPersonsToUnitPersons (affects the NEXT predpis publish only).

// TODO(decision): readings must be dated inside the round year — the
// vyúčtovanie query filters by calendar year, so an early-January reading
// dated in the next year would silently not count. Spec allowed ± grace
// days; kept at 0 until the year-boundary engine slice lands.
const ROUND_GRACE_DAYS = 0;

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const DAY_MS = 24 * 3600 * 1000;

type RoundRow = typeof readingRounds.$inferSelect;

// ── Rounds ─────────────────────────────────────────────

export interface RoundInfo {
  id: string;
  year: number;
  opensAt: string;
  deadlineAt: string;
  closedForOwnersAt: string | null;
  allowLate: boolean;
  collectPersons: boolean;
  meterTypes: MeterType[];
  reminderDaysBefore: number;
}

function roundInfo(r: RoundRow): RoundInfo {
  return {
    id: r.id,
    year: r.year,
    opensAt: r.opensAt.toISOString(),
    deadlineAt: r.deadlineAt.toISOString(),
    closedForOwnersAt: r.closedForOwnersAt?.toISOString() ?? null,
    allowLate: r.allowLate,
    collectPersons: r.collectPersons,
    meterTypes: r.meterTypes as MeterType[],
    reminderDaysBefore: r.reminderDaysBefore,
  };
}

export async function getRoundByYear(
  entityId: string,
  year: number
): Promise<RoundRow | null> {
  const [r] = await db
    .select()
    .from(readingRounds)
    .where(and(eq(readingRounds.entityId, entityId), eq(readingRounds.year, year)));
  return r ?? null;
}

async function loadRound(
  executor: Tx | typeof db,
  entityId: string,
  roundId: string
): Promise<RoundRow> {
  const [r] = await executor
    .select()
    .from(readingRounds)
    .where(and(eq(readingRounds.id, roundId), eq(readingRounds.entityId, entityId)));
  if (!r) throw new ReadingError("not_found");
  return r;
}

/** Owner input state of a round at `now` (lock checked separately). */
function ownerWindow(
  r: RoundRow,
  now: Date
): { open: true; late: boolean } | { open: false; code: "round_not_open" | "round_closed_for_owner" } {
  if (now < r.opensAt) return { open: false, code: "round_not_open" };
  if (r.closedForOwnersAt) return { open: false, code: "round_closed_for_owner" };
  const late = now > r.deadlineAt;
  if (late && !r.allowLate) return { open: false, code: "round_closed_for_owner" };
  return { open: true, late };
}

export interface RoundInput {
  year: number;
  opensAt: Date;
  deadlineAt: Date;
  collectPersons: boolean;
  meterTypes: MeterType[];
  reminderDaysBefore: number;
  allowLate: boolean;
}

/** Pure validation of the board's round form. */
export function validateRoundInput(body: Record<string, unknown>): RoundInput {
  const year = Number(body.year);
  const opensAt = new Date(`${String(body.opensAt ?? "")}T00:00:00Z`);
  const deadlineAt = new Date(`${String(body.deadlineAt ?? "")}T23:59:59Z`);
  const reminderDaysBefore = Number(body.reminderDaysBefore ?? 5);
  const meterTypes = Array.isArray(body.meterTypes)
    ? (body.meterTypes as unknown[]).filter((m): m is MeterType =>
        ROUND_METER_TYPES.includes(m as MeterType)
      )
    : [];
  const collectPersons = body.collectPersons === true;
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    Number.isNaN(opensAt.getTime()) ||
    Number.isNaN(deadlineAt.getTime()) ||
    deadlineAt < opensAt ||
    !Number.isInteger(reminderDaysBefore) ||
    reminderDaysBefore < 0 ||
    reminderDaysBefore > 30 ||
    (!collectPersons && meterTypes.length === 0)
  ) {
    throw new ReadingError("round_invalid");
  }
  return {
    year,
    opensAt,
    deadlineAt,
    collectPersons,
    meterTypes: [...new Set(meterTypes)],
    reminderDaysBefore,
    allowLate: body.allowLate !== false,
  };
}

/** Create (no id) or edit a round. Board writers only (caller checks). */
export async function saveRound(input: {
  entityId: string;
  actorId: string;
  roundId?: string | null;
  data: RoundInput;
}): Promise<{ id: string }> {
  const { data } = input;
  return db.transaction(async (tx) => {
    await assertReadingYearOpen(input.entityId, data.year, tx);

    if (input.roundId) {
      const before = await loadRound(tx, input.entityId, input.roundId);
      if (before.year !== data.year) throw new ReadingError("round_invalid");
      await tx
        .update(readingRounds)
        .set({
          opensAt: data.opensAt,
          deadlineAt: data.deadlineAt,
          collectPersons: data.collectPersons,
          meterTypes: data.meterTypes,
          reminderDaysBefore: data.reminderDaysBefore,
          allowLate: data.allowLate,
        })
        .where(eq(readingRounds.id, before.id));
      await tx.insert(auditLog).values({
        entityId: input.entityId,
        actorId: input.actorId,
        action: "update",
        tableName: "mod_accounting_reading_rounds",
        recordId: before.id,
        before: roundInfo(before),
        after: { ...data, opensAt: data.opensAt.toISOString(), deadlineAt: data.deadlineAt.toISOString() },
      });
      return { id: before.id };
    }

    // Same insert-first get-or-create as periods.ts; a round needs its
    // period row (FK) — an open period for the year is minted if missing.
    await tx
      .insert(accountingPeriods)
      .values({ entityId: input.entityId, year: data.year })
      .onConflictDoNothing();
    const [period] = await tx
      .select({ id: accountingPeriods.id })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.entityId, input.entityId),
          eq(accountingPeriods.year, data.year)
        )
      );
    if (!period) throw new ReadingError("round_invalid");

    const [row] = await tx
      .insert(readingRounds)
      .values({
        entityId: input.entityId,
        periodId: period.id,
        year: data.year,
        opensAt: data.opensAt,
        deadlineAt: data.deadlineAt,
        collectPersons: data.collectPersons,
        meterTypes: data.meterTypes,
        reminderDaysBefore: data.reminderDaysBefore,
        allowLate: data.allowLate,
        createdById: input.actorId,
      })
      .onConflictDoNothing()
      .returning({ id: readingRounds.id });
    if (!row) throw new ReadingError("round_exists");
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_reading_rounds",
      recordId: row.id,
      after: { ...data, opensAt: data.opensAt.toISOString(), deadlineAt: data.deadlineAt.toISOString() },
    });
    return { id: row.id };
  });
}

/** Board "uzavrieť zber" / reopen for owners. */
export async function setRoundClosedForOwners(input: {
  entityId: string;
  roundId: string;
  closed: boolean;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await loadRound(tx, input.entityId, input.roundId);
    await assertReadingYearOpen(input.entityId, r.year, tx);
    await tx
      .update(readingRounds)
      .set({ closedForOwnersAt: input.closed ? new Date() : null })
      .where(eq(readingRounds.id, r.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: input.closed ? "lock" : "update",
      tableName: "mod_accounting_reading_rounds",
      recordId: r.id,
      before: { closedForOwnersAt: r.closedForOwnersAt?.toISOString() ?? null },
      after: { closedForOwners: input.closed },
    });
  });
}

// ── Owner view ─────────────────────────────────────────

/**
 * The round shown to owners: the newest round that has opened and is not
 * closed for owners. Before opensAt / after closing → null (summary only).
 */
async function currentOwnerRound(entityId: string, now: Date): Promise<RoundRow | null> {
  const [r] = await db
    .select()
    .from(readingRounds)
    .where(
      and(
        eq(readingRounds.entityId, entityId),
        sql`${readingRounds.opensAt} <= ${now}`,
        isNull(readingRounds.closedForOwnersAt)
      )
    )
    .orderBy(desc(readingRounds.year))
    .limit(1);
  return r ?? null;
}

export async function getOwnerReadingsView(input: {
  entityId: string;
  unitEntityId: string;
  userId: string;
}): Promise<OwnerReadingsView> {
  const now = new Date();
  const { entityId, unitEntityId, userId } = input;

  const [round, lastReading, lastPersons] = await Promise.all([
    currentOwnerRound(entityId, now),
    db
      .select({ at: sql<Date | null>`max(${meterReadings.createdAt})` })
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.entityId, entityId),
          eq(meterReadings.unitEntityId, unitEntityId),
          isNull(meterReadings.voidedAt)
        )
      ),
    db
      .select({ at: sql<Date | null>`max(${personMonths.createdAt})` })
      .from(personMonths)
      .where(
        and(
          eq(personMonths.entityId, entityId),
          eq(personMonths.unitEntityId, unitEntityId),
          isNull(personMonths.voidedAt)
        )
      ),
  ]);
  const lastAts = [lastReading[0]?.at, lastPersons[0]?.at]
    .filter((d): d is Date => d != null)
    .map((d) => new Date(d).getTime());
  const lastSubmissionAt = lastAts.length
    ? new Date(Math.max(...lastAts)).toISOString()
    : null;

  // Last known reading per type outside the shown round — hint + "lower
  // than last time" soft warning.
  const history = await db
    .select({
      meterType: meterReadings.meterType,
      valueMilli: meterReadings.valueMilli,
      readingDate: meterReadings.readingDate,
      roundId: meterReadings.roundId,
    })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.entityId, entityId),
        eq(meterReadings.unitEntityId, unitEntityId),
        isNull(meterReadings.voidedAt)
      )
    )
    .orderBy(desc(meterReadings.readingDate), desc(meterReadings.createdAt));
  const lastKnown: OwnerReadingsView["lastKnown"] = {};
  for (const h of history) {
    if (round && h.roundId === round.id) continue;
    const t = h.meterType as MeterType;
    if (!lastKnown[t]) {
      lastKnown[t] = { value: h.valueMilli, readingDate: h.readingDate.toISOString() };
    }
  }

  if (!round) return { round: null, entries: [], lastKnown, lastSubmissionAt };

  // A settled (locked) year is history: show the summary line only.
  if (await isReadingYearLocked(entityId, round.year)) {
    return { round: null, entries: [], lastKnown, lastSubmissionAt };
  }
  const window = ownerWindow(round, now);
  const acceptsInput = window.open;

  const [readings, persons] = await Promise.all([
    db
      .select({
        id: meterReadings.id,
        meterType: meterReadings.meterType,
        valueMilli: meterReadings.valueMilli,
        readingDate: meterReadings.readingDate,
        photoStorageKey: meterReadings.photoStorageKey,
        late: meterReadings.late,
        resolvedAt: meterReadings.resolvedAt,
        createdById: meterReadings.createdById,
        createdAt: meterReadings.createdAt,
      })
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.roundId, round.id),
          eq(meterReadings.unitEntityId, unitEntityId),
          isNull(meterReadings.voidedAt)
        )
      )
      .orderBy(asc(meterReadings.createdAt)),
    db
      .select({
        submissionId: personMonths.submissionId,
        month: personMonths.month,
        personsCount: personMonths.personsCount,
        late: personMonths.late,
        resolvedAt: personMonths.resolvedAt,
        createdById: personMonths.createdById,
        createdAt: personMonths.createdAt,
      })
      .from(personMonths)
      .where(
        and(
          eq(personMonths.roundId, round.id),
          eq(personMonths.unitEntityId, unitEntityId),
          isNull(personMonths.voidedAt)
        )
      )
      .orderBy(asc(personMonths.month)),
  ]);

  // Built field by field — the owner shape must never pick up a new column.
  const entries: OwnerReadingEntry[] = [];
  const bySubmission = new Map<string, typeof persons>();
  for (const p of persons) {
    const arr = bySubmission.get(p.submissionId);
    if (arr) arr.push(p);
    else bySubmission.set(p.submissionId, [p]);
  }
  for (const [submissionId, rows] of bySubmission) {
    entries.push({
      id: submissionId,
      kind: "persons",
      months: collapsePersonMonths(
        rows.map((r) => ({ month: r.month, persons: r.personsCount }))
      ),
      value: null,
      readingDate: null,
      photo: null,
      late: rows.some((r) => r.late),
      canEdit:
        acceptsInput &&
        rows.every((r) => r.createdById === userId && r.resolvedAt === null),
      createdAt: rows[0].createdAt.toISOString(),
    });
  }
  for (const r of readings) {
    entries.push({
      id: r.id,
      kind: r.meterType as MeterType,
      months: null,
      value: r.valueMilli,
      readingDate: r.readingDate.toISOString(),
      photo: r.photoStorageKey ? readingPhotoUrl("unit", r.id) : null,
      late: r.late,
      canEdit: acceptsInput && r.createdById === userId && r.resolvedAt === null,
      createdAt: r.createdAt.toISOString(),
    });
  }

  return {
    round: {
      id: round.id,
      year: round.year,
      opensAt: round.opensAt.toISOString(),
      deadlineAt: round.deadlineAt.toISOString(),
      collectPersons: round.collectPersons,
      meterTypes: round.meterTypes as MeterType[],
      acceptsInput,
      late: window.open ? window.late : false,
    },
    entries,
    lastKnown,
    lastSubmissionAt,
  };
}

// ── Submissions (owner + board) ────────────────────────

interface Actor {
  entityId: string;
  actorId: string;
  /** Board writer (treasurer / admin) — skips owner-window rules. */
  isWriter: boolean;
}

/** Owner-window gate; board writers pass. Returns the `late` flag. */
function gateOwner(round: RoundRow, actor: Actor): boolean {
  if (actor.isWriter) return false;
  const w = ownerWindow(round, new Date());
  if (!w.open) throw new ReadingError(w.code);
  return w.late;
}

/** Persons per month for a unit (ranges), optionally replacing a submission. */
export async function submitPersons(
  actor: Actor & {
    roundId: string;
    unitEntityId: string;
    ranges: PersonRange[];
    replaceSubmissionId?: string | null;
  }
): Promise<{ submissionId: string }> {
  const invalid = validatePersonRanges(actor.ranges);
  if (invalid) throw new ReadingError(invalid);

  return db.transaction(async (tx) => {
    const round = await loadRound(tx, actor.entityId, actor.roundId);
    if (!round.collectPersons) throw new ReadingError("round_invalid");
    await assertReadingYearOpen(actor.entityId, round.year, tx);
    const late = gateOwner(round, actor);

    const [unit] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, actor.unitEntityId), domUnitsWhere(actor.entityId)));
    if (!unit) throw new ReadingError("unknown_unit");

    if (actor.replaceSubmissionId) {
      await voidPersonsTx(tx, {
        ...actor,
        submissionId: actor.replaceSubmissionId,
        expectUnitId: actor.unitEntityId,
        justification: actor.isWriter ? "board entry (correction)" : "owner edit",
      });
    }

    const months = expandPersonRanges(actor.ranges);
    const taken = await tx
      .select({ month: personMonths.month })
      .from(personMonths)
      .where(
        and(
          eq(personMonths.unitEntityId, actor.unitEntityId),
          eq(personMonths.year, round.year),
          isNull(personMonths.voidedAt),
          inArray(
            personMonths.month,
            months.map((m) => m.month)
          )
        )
      );
    if (taken.length > 0) throw new ReadingError("month_range_overlap");

    const submissionId = randomUUID();
    // The partial unique index (unit, year, month) WHERE voided_at IS NULL
    // is the race guard behind the pre-check above.
    await tx
      .insert(personMonths)
      .values(
      months.map((m) => ({
        entityId: actor.entityId,
        unitEntityId: actor.unitEntityId,
        roundId: round.id,
        year: round.year,
        month: m.month,
        personsCount: m.persons,
        submissionId,
        late,
        createdById: actor.actorId,
      }))
      )
      .catch((err: unknown) => {
        const e = err as { code?: string; cause?: { code?: string } };
        if (e?.code === "23505" || e?.cause?.code === "23505") {
          throw new ReadingError("month_range_overlap");
        }
        throw err;
      });
    await tx.insert(auditLog).values({
      entityId: actor.entityId,
      actorId: actor.actorId,
      action: "insert",
      tableName: "mod_accounting_person_months",
      recordId: submissionId,
      after: { unitEntityId: actor.unitEntityId, year: round.year, ranges: actor.ranges, late },
      justification: actor.isWriter ? "board entry" : null,
    });
    return { submissionId };
  });
}

async function voidPersonsTx(
  tx: Tx,
  input: Actor & {
    submissionId: string;
    expectUnitId?: string;
    justification: string;
  }
): Promise<void> {
  const rows = await tx
    .select({
      id: personMonths.id,
      unitEntityId: personMonths.unitEntityId,
      roundId: personMonths.roundId,
      year: personMonths.year,
      month: personMonths.month,
      personsCount: personMonths.personsCount,
      resolvedAt: personMonths.resolvedAt,
      createdById: personMonths.createdById,
    })
    .from(personMonths)
    .where(
      and(
        eq(personMonths.submissionId, input.submissionId),
        eq(personMonths.entityId, input.entityId),
        isNull(personMonths.voidedAt)
      )
    )
    .for("update");
  if (rows.length === 0) throw new ReadingError("not_found");
  if (input.expectUnitId && rows.some((r) => r.unitEntityId !== input.expectUnitId)) {
    throw new ReadingError("not_found");
  }
  await assertReadingYearOpen(input.entityId, rows[0].year, tx);
  if (!input.isWriter) {
    if (rows.some((r) => r.createdById !== input.actorId)) {
      throw new ReadingError("forbidden");
    }
    if (rows.some((r) => r.resolvedAt)) throw new ReadingError("submission_locked");
    const round = await loadRound(tx, input.entityId, rows[0].roundId);
    if (!ownerWindow(round, new Date()).open) {
      throw new ReadingError("submission_locked");
    }
  }
  await tx
    .update(personMonths)
    .set({ voidedAt: new Date(), voidedById: input.actorId })
    .where(
      inArray(
        personMonths.id,
        rows.map((r) => r.id)
      )
    );
  await tx.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.actorId,
    action: "void",
    tableName: "mod_accounting_person_months",
    recordId: input.submissionId,
    before: {
      unitEntityId: rows[0].unitEntityId,
      months: rows.map((r) => ({ month: r.month, persons: r.personsCount })),
    },
    after: { voidedAt: true },
    justification: input.justification,
  });
}

/** Withdraw a persons submission (owner while editable, board any). */
export async function voidPersonsSubmission(
  actor: Actor & { submissionId: string; unitEntityId?: string }
): Promise<void> {
  await db.transaction((tx) =>
    voidPersonsTx(tx, {
      ...actor,
      expectUnitId: actor.unitEntityId,
      justification: actor.isWriter ? "board void" : "owner withdrew submission",
    })
  );
}

/** Upload a reading photo; returns the proxy-only storage key. */
export async function storeReadingPhoto(
  entityId: string,
  photo: { body: Buffer; contentType: string }
): Promise<string> {
  const ext = PHOTO_TYPES[photo.contentType];
  if (!ext) throw new ReadingError("photo_type_invalid");
  if (photo.body.length === 0 || photo.body.length > PHOTO_MAX_BYTES) {
    throw new ReadingError("photo_too_large");
  }
  // "accounting…" prefix ⇒ proxy-only (storage.ts PROXY_ONLY_KEY_PREFIXES):
  // never a signed/public URL, only the auth-checked photo route.
  const key = buildStorageKey(`accounting-readings-${entityId}`, `${randomUUID()}.${ext}`);
  await getStorage().put(key, photo.body, { contentType: photo.contentType });
  return key;
}

function assertDateInRound(readingDate: Date, year: number) {
  if (Number.isNaN(readingDate.getTime())) throw new ReadingError("date_outside_round");
  if (readingDate.getTime() > Date.now() + DAY_MS) throw new ReadingError("date_in_future");
  const start = Date.UTC(year, 0, 1) - ROUND_GRACE_DAYS * DAY_MS;
  const end = Date.UTC(year + 1, 0, 1) + ROUND_GRACE_DAYS * DAY_MS;
  const t = readingDate.getTime();
  if (t < start || t >= end) throw new ReadingError("date_outside_round");
}

/** One meter reading in a round (owner or board), optionally replacing one. */
export async function submitRoundReading(
  actor: Actor & {
    roundId: string;
    unitEntityId: string;
    meterType: MeterType;
    readingDate: Date;
    valueMilli: number;
    note?: string | null;
    photoStorageKey?: string | null;
    replaceReadingId?: string | null;
  }
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const round = await loadRound(tx, actor.entityId, actor.roundId);
    if (!(round.meterTypes as MeterType[]).includes(actor.meterType)) {
      throw new ReadingError("meter_type_not_collected");
    }
    await assertReadingYearOpen(actor.entityId, round.year, tx);
    const late = gateOwner(round, actor);
    assertDateInRound(actor.readingDate, round.year);

    let keepPhoto: string | null = null;
    if (actor.replaceReadingId) {
      const [old] = await tx
        .select({
          unitEntityId: meterReadings.unitEntityId,
          roundId: meterReadings.roundId,
          photoStorageKey: meterReadings.photoStorageKey,
        })
        .from(meterReadings)
        .where(
          and(
            eq(meterReadings.id, actor.replaceReadingId),
            eq(meterReadings.entityId, actor.entityId)
          )
        );
      if (!old || old.unitEntityId !== actor.unitEntityId || old.roundId !== round.id) {
        throw new ReadingError("not_found");
      }
      keepPhoto = old.photoStorageKey;
      await voidReadingTx(tx, {
        entityId: actor.entityId,
        readingId: actor.replaceReadingId,
        actorId: actor.actorId,
        isWriter: actor.isWriter,
        justification: actor.isWriter ? "board entry (correction)" : "owner edit",
      });
    } else {
      const [dup] = await tx
        .select({ id: meterReadings.id })
        .from(meterReadings)
        .where(
          and(
            eq(meterReadings.roundId, round.id),
            eq(meterReadings.unitEntityId, actor.unitEntityId),
            eq(meterReadings.meterType, actor.meterType),
            isNull(meterReadings.voidedAt)
          )
        )
        .limit(1);
      if (dup) throw new ReadingError("already_submitted");
    }

    return insertReadingTx(tx, {
      entityId: actor.entityId,
      unitEntityId: actor.unitEntityId,
      meterType: actor.meterType,
      readingDate: actor.readingDate,
      valueMilli: actor.valueMilli,
      actorId: actor.actorId,
      roundId: round.id,
      // An edit without a new photo keeps the previous one.
      photoStorageKey: actor.photoStorageKey ?? keepPhoto,
      note: actor.note ?? null,
      late,
      justification: actor.isWriter ? "board entry" : null,
    });
  });
}

/** Withdraw a round reading (owner while editable, board any). */
export async function withdrawRoundReading(
  actor: Actor & { readingId: string; unitEntityId?: string }
): Promise<void> {
  await db.transaction(async (tx) => {
    if (actor.unitEntityId) {
      const [row] = await tx
        .select({ unitEntityId: meterReadings.unitEntityId })
        .from(meterReadings)
        .where(
          and(eq(meterReadings.id, actor.readingId), eq(meterReadings.entityId, actor.entityId))
        );
      if (!row || row.unitEntityId !== actor.unitEntityId) throw new ReadingError("not_found");
    }
    await voidReadingTx(tx, {
      entityId: actor.entityId,
      readingId: actor.readingId,
      actorId: actor.actorId,
      isWriter: actor.isWriter,
      justification: actor.isWriter ? "board void" : "owner withdrew submission",
    });
  });
}

// ── Board: resolve ─────────────────────────────────────

/** Mark / unmark every round entry of the given units as "vyriešené". */
export async function setUnitsResolved(input: {
  entityId: string;
  roundId: string;
  unitIds: string[];
  resolved: boolean;
  actorId: string;
}): Promise<{ updated: number }> {
  if (input.unitIds.length === 0) return { updated: 0 };
  return db.transaction(async (tx) => {
    const round = await loadRound(tx, input.entityId, input.roundId);
    await assertReadingYearOpen(input.entityId, round.year, tx);
    const patch = input.resolved
      ? { resolvedAt: new Date(), resolvedById: input.actorId }
      : { resolvedAt: null, resolvedById: null };
    const r1 = await tx
      .update(meterReadings)
      .set(patch)
      .where(
        and(
          eq(meterReadings.roundId, round.id),
          inArray(meterReadings.unitEntityId, input.unitIds),
          isNull(meterReadings.voidedAt)
        )
      )
      .returning({ id: meterReadings.id });
    const r2 = await tx
      .update(personMonths)
      .set(patch)
      .where(
        and(
          eq(personMonths.roundId, round.id),
          inArray(personMonths.unitEntityId, input.unitIds),
          isNull(personMonths.voidedAt)
        )
      )
      .returning({ id: personMonths.id });
    await tx.insert(auditLog).values(
      input.unitIds.map((unitId) => ({
        entityId: input.entityId,
        actorId: input.actorId,
        action: input.resolved ? "resolve" : "unresolve",
        tableName: "mod_accounting_reading_rounds",
        recordId: round.id,
        after: { unitEntityId: unitId, resolved: input.resolved },
      }))
    );
    return { updated: r1.length + r2.length };
  });
}

// ── Board: table ───────────────────────────────────────

export type InputStatus = "missing" | "submitted" | "late" | "resolved";

export interface BoardMeterCell {
  readingId: string;
  value: number;
  readingDate: string;
  late: boolean;
  resolved: boolean;
  photo: string | null;
  note: string | null;
  submittedAt: string;
  byBoard: boolean;
  status: InputStatus;
}

export interface BoardUnitRow {
  unitEntityId: string;
  label: string;
  vs: string | null;
  persons: {
    status: InputStatus;
    /** Index 0 = January; null = not reported. */
    months: (number | null)[];
    total: number;
    submissions: { submissionId: string; ranges: PersonRange[] }[];
  } | null;
  meters: Partial<Record<MeterType, BoardMeterCell | null>>;
  /** Metered types with exactly ONE reading in the year → consFor treats it
   * as consumption (absolute counter state). Display-only warning. */
  singleReadingTypes: MeterType[];
}

export interface BuildingReadingRow {
  id: string;
  meterType: MeterType;
  label: string;
  readingDate: string;
  value: number;
  note: string | null;
  photo: string | null;
}

export interface BoardRoundData {
  year: number;
  round: RoundInfo | null;
  locked: boolean;
  years: number[];
  units: BoardUnitRow[];
  building: BuildingReadingRow[];
}

function statusOf(rows: { late: boolean; resolvedAt: Date | null }[]): InputStatus {
  if (rows.length === 0) return "missing";
  if (rows.every((r) => r.resolvedAt)) return "resolved";
  return rows.some((r) => r.late) ? "late" : "submitted";
}

const SETTLED_METER_TYPES: MeterType[] = ["heat", "water_hot"];

/** Units with exactly one non-voided reading in the year per metered type. */
async function singleReadingMap(
  entityId: string,
  year: number
): Promise<Map<string, MeterType[]>> {
  const rows = await db
    .select({
      unitId: meterReadings.unitEntityId,
      type: meterReadings.meterType,
      n: sql<number>`count(*)::int`,
    })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.entityId, entityId),
        isNull(meterReadings.voidedAt),
        gte(meterReadings.readingDate, new Date(Date.UTC(year, 0, 1))),
        lt(meterReadings.readingDate, new Date(Date.UTC(year + 1, 0, 1))),
        inArray(meterReadings.meterType, SETTLED_METER_TYPES)
      )
    )
    .groupBy(meterReadings.unitEntityId, meterReadings.meterType);
  const out = new Map<string, MeterType[]>();
  for (const r of rows) {
    if (r.n !== 1) continue;
    const arr = out.get(r.unitId) ?? [];
    arr.push(r.type as MeterType);
    out.set(r.unitId, arr);
  }
  return out;
}

export async function getBoardRoundData(
  entityId: string,
  year: number
): Promise<BoardRoundData> {
  const [round, yearsRows, locked, units, vsRows, single] = await Promise.all([
    getRoundByYear(entityId, year),
    db
      .select({ year: readingRounds.year })
      .from(readingRounds)
      .where(eq(readingRounds.entityId, entityId))
      .orderBy(desc(readingRounds.year)),
    isReadingYearLocked(entityId, year),
    listDomUnits(entityId),
    db
      .select({ unitEntityId: unitSettings.unitEntityId, vs: unitSettings.vs })
      .from(unitSettings)
      .where(eq(unitSettings.entityId, entityId)),
    singleReadingMap(entityId, year),
  ]);
  const vsByUnit = new Map(vsRows.map((v) => [v.unitEntityId, v.vs]));
  const years = yearsRows.map((y) => y.year);

  const [readings, persons, building] = round
    ? await Promise.all([
        db
          .select({
            id: meterReadings.id,
            unitEntityId: meterReadings.unitEntityId,
            meterType: meterReadings.meterType,
            valueMilli: meterReadings.valueMilli,
            readingDate: meterReadings.readingDate,
            late: meterReadings.late,
            resolvedAt: meterReadings.resolvedAt,
            photoStorageKey: meterReadings.photoStorageKey,
            note: meterReadings.note,
            createdAt: meterReadings.createdAt,
            createdById: meterReadings.createdById,
          })
          .from(meterReadings)
          .where(and(eq(meterReadings.roundId, round.id), isNull(meterReadings.voidedAt)))
          .orderBy(desc(meterReadings.createdAt)),
        db
          .select({
            unitEntityId: personMonths.unitEntityId,
            submissionId: personMonths.submissionId,
            month: personMonths.month,
            personsCount: personMonths.personsCount,
            late: personMonths.late,
            resolvedAt: personMonths.resolvedAt,
          })
          .from(personMonths)
          .where(and(eq(personMonths.roundId, round.id), isNull(personMonths.voidedAt))),
        listBuildingReadings(entityId, round.id),
      ])
    : [[], [], []];

  // "Entered by the board" = creator holds no owner membership on the unit.
  const ownerPairs = new Set<string>();
  if (readings.length > 0) {
    const own = await db
      .select({ userId: memberships.userId, unitId: memberships.entityId })
      .from(memberships)
      .where(
        and(
          inArray(
            memberships.entityId,
            [...new Set(readings.map((r) => r.unitEntityId))]
          ),
          eq(memberships.role, "owner")
        )
      );
    for (const o of own) ownerPairs.add(`${o.userId}|${o.unitId}`);
  }

  const rows: BoardUnitRow[] = units.map((u) => {
    const unitPersonsRows = persons.filter((p) => p.unitEntityId === u.id);
    let personsCell: BoardUnitRow["persons"] = null;
    if (round?.collectPersons) {
      const months: (number | null)[] = Array(12).fill(null);
      const subs = new Map<string, { month: number; persons: number }[]>();
      for (const p of unitPersonsRows) {
        months[p.month - 1] = p.personsCount;
        const arr = subs.get(p.submissionId) ?? [];
        arr.push({ month: p.month, persons: p.personsCount });
        subs.set(p.submissionId, arr);
      }
      personsCell = {
        status: statusOf(unitPersonsRows),
        months,
        total: months.reduce<number>((s, m) => s + (m ?? 0), 0),
        submissions: [...subs].map(([submissionId, ms]) => ({
          submissionId,
          ranges: collapsePersonMonths(ms),
        })),
      };
    }
    const meters: BoardUnitRow["meters"] = {};
    for (const type of (round?.meterTypes ?? []) as MeterType[]) {
      // Newest non-voided first (orderBy createdAt desc).
      const r = readings.find((x) => x.unitEntityId === u.id && x.meterType === type);
      meters[type] = r
        ? {
            readingId: r.id,
            value: r.valueMilli,
            readingDate: r.readingDate.toISOString(),
            late: r.late,
            resolved: r.resolvedAt !== null,
            photo: r.photoStorageKey ? readingPhotoUrl("unit", r.id) : null,
            note: r.note,
            submittedAt: r.createdAt.toISOString(),
            byBoard: !ownerPairs.has(`${r.createdById}|${u.id}`),
            status: statusOf([r]),
          }
        : null;
    }
    return {
      unitEntityId: u.id,
      label: u.flatNumber ?? u.name,
      vs: vsByUnit.get(u.id) ?? null,
      persons: personsCell,
      meters,
      singleReadingTypes: single.get(u.id) ?? [],
    };
  });

  return {
    year,
    round: round ? roundInfo(round) : null,
    locked,
    years,
    units: rows,
    building,
  };
}

/** Missing = no non-voided entry for SOME enabled input of the round. */
export function isUnitMissing(row: BoardUnitRow): boolean {
  if (row.persons && row.persons.status === "missing") return true;
  return Object.values(row.meters).some((c) => c === null);
}

export function isUnitUnresolved(row: BoardUnitRow): boolean {
  if (row.persons && (row.persons.status === "submitted" || row.persons.status === "late")) {
    return true;
  }
  return Object.values(row.meters).some((c) => c !== null && c !== undefined && !c.resolved);
}

/** Vyúčtovanie wizard gate (informational, never blocking). */
export async function getReadingRoundGate(
  entityId: string,
  year: number
): Promise<{
  hasRound: boolean;
  missingUnits: number;
  unresolvedUnits: number;
  singleReadingUnits: number;
}> {
  const data = await getBoardRoundData(entityId, year);
  return {
    hasRound: data.round !== null,
    missingUnits: data.round ? data.units.filter(isUnitMissing).length : 0,
    unresolvedUnits: data.round ? data.units.filter(isUnitUnresolved).length : 0,
    singleReadingUnits: data.units.filter((u) => u.singleReadingTypes.length > 0).length,
  };
}

// ── Building / common meters ───────────────────────────

async function listBuildingReadings(
  entityId: string,
  roundId: string
): Promise<BuildingReadingRow[]> {
  const rows = await db
    .select()
    .from(buildingMeterReadings)
    .where(
      and(
        eq(buildingMeterReadings.entityId, entityId),
        eq(buildingMeterReadings.roundId, roundId),
        isNull(buildingMeterReadings.voidedAt)
      )
    )
    .orderBy(asc(buildingMeterReadings.readingDate));
  return rows.map((r) => ({
    id: r.id,
    meterType: r.meterType as MeterType,
    label: r.label,
    readingDate: r.readingDate.toISOString(),
    value: r.valueMilli,
    note: r.note,
    photo: r.photoStorageKey ? readingPhotoUrl("building", r.id) : null,
  }));
}

export async function createBuildingReading(input: {
  entityId: string;
  actorId: string;
  roundId: string;
  meterType: MeterType;
  label: string;
  readingDate: Date;
  valueMilli: number;
  note?: string | null;
  photoStorageKey?: string | null;
}): Promise<{ id: string }> {
  const label = input.label.trim();
  if (!label || label.length > 120) throw new ReadingError("label_required");
  if (!ROUND_METER_TYPES.includes(input.meterType)) throw new ReadingError("round_invalid");
  if (!Number.isSafeInteger(input.valueMilli)) throw new ReadingError("value_invalid");
  if (input.valueMilli < 0) throw new ReadingError("value_negative");
  if (Number.isNaN(input.readingDate.getTime())) throw new ReadingError("date_outside_round");
  if (input.readingDate.getTime() > Date.now() + DAY_MS) throw new ReadingError("date_in_future");

  return db.transaction(async (tx) => {
    const round = await loadRound(tx, input.entityId, input.roundId);
    await assertReadingYearOpen(input.entityId, round.year, tx);
    // Backdated is fine; a date in a LOCKED year is not.
    await assertReadingYearOpen(input.entityId, utcYear(input.readingDate), tx);
    const [row] = await tx
      .insert(buildingMeterReadings)
      .values({
        entityId: input.entityId,
        roundId: round.id,
        meterType: input.meterType,
        label,
        readingDate: input.readingDate,
        valueMilli: input.valueMilli,
        note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
        photoStorageKey: input.photoStorageKey ?? null,
        createdById: input.actorId,
      })
      .returning({ id: buildingMeterReadings.id });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_building_meter_readings",
      recordId: row.id,
      after: {
        meterType: input.meterType,
        label,
        readingDate: input.readingDate.toISOString(),
        valueMilli: input.valueMilli,
      },
      justification: "board entry",
    });
    return { id: row.id };
  });
}

export async function voidBuildingReading(input: {
  entityId: string;
  actorId: string;
  id: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(buildingMeterReadings)
      .where(
        and(
          eq(buildingMeterReadings.id, input.id),
          eq(buildingMeterReadings.entityId, input.entityId)
        )
      )
      .for("update");
    if (!row) throw new ReadingError("not_found");
    if (row.voidedAt) throw new ReadingError("already_voided");
    await assertReadingYearOpen(input.entityId, utcYear(row.readingDate), tx);
    if (row.roundId) {
      const round = await loadRound(tx, input.entityId, row.roundId);
      await assertReadingYearOpen(input.entityId, round.year, tx);
    }
    await tx
      .update(buildingMeterReadings)
      .set({ voidedAt: new Date(), voidedById: input.actorId })
      .where(eq(buildingMeterReadings.id, row.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "void",
      tableName: "mod_accounting_building_meter_readings",
      recordId: row.id,
      before: { label: row.label, valueMilli: row.valueMilli },
      after: { voidedAt: true },
    });
  });
}

// ── Hand-off: person-months → unit_persons ─────────────

/**
 * "Použiť pre mesačné platby" — manual board action. For RESOLVED person
 * months not yet applied, writes mod_accounting_unit_persons rows only at
 * months where the count changes (vs. the value effective just before).
 * Affects only the NEXT predpis publish: published fee_assessments carry
 * their own snapshot and are never touched here.
 */
export async function applyPersonsToUnitPersons(input: {
  entityId: string;
  roundId: string;
  actorId: string;
}): Promise<{ unitsUpdated: number; rowsCreated: number }> {
  return db.transaction(async (tx) => {
    const round = await loadRound(tx, input.entityId, input.roundId);
    await assertReadingYearOpen(input.entityId, round.year, tx);

    const rows = await tx
      .select({
        id: personMonths.id,
        unitEntityId: personMonths.unitEntityId,
        month: personMonths.month,
        personsCount: personMonths.personsCount,
      })
      .from(personMonths)
      .where(
        and(
          eq(personMonths.roundId, round.id),
          isNull(personMonths.voidedAt),
          isNull(personMonths.appliedUnitPersonsId),
          sql`${personMonths.resolvedAt} IS NOT NULL`
        )
      )
      .orderBy(asc(personMonths.unitEntityId), asc(personMonths.month))
      .for("update");

    const byUnit = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byUnit.get(r.unitEntityId) ?? [];
      arr.push(r);
      byUnit.set(r.unitEntityId, arr);
    }

    let rowsCreated = 0;
    for (const [unitId, months] of byUnit) {
      const history = await tx
        .select({
          id: unitPersons.id,
          personsCount: unitPersons.personsCount,
          effectiveFrom: unitPersons.effectiveFrom,
        })
        .from(unitPersons)
        .where(eq(unitPersons.unitEntityId, unitId))
        .orderBy(asc(unitPersons.effectiveFrom), asc(unitPersons.createdAt));

      for (const m of months) {
        const monthStart = new Date(Date.UTC(round.year, m.month - 1, 1));
        let effective: (typeof history)[number] | null = null;
        for (const h of history) {
          if (h.effectiveFrom.getTime() <= monthStart.getTime()) effective = h;
        }
        let appliedId: string;
        if (effective && effective.personsCount === m.personsCount) {
          appliedId = effective.id;
        } else {
          const [created] = await tx
            .insert(unitPersons)
            .values({
              unitEntityId: unitId,
              personsCount: m.personsCount,
              effectiveFrom: monthStart,
              createdById: input.actorId,
            })
            .returning({
              id: unitPersons.id,
              personsCount: unitPersons.personsCount,
              effectiveFrom: unitPersons.effectiveFrom,
            });
          history.push(created);
          history.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
          appliedId = created.id;
          rowsCreated += 1;
          await tx.insert(auditLog).values({
            entityId: input.entityId,
            actorId: input.actorId,
            action: "insert",
            tableName: "mod_accounting_unit_persons",
            recordId: created.id,
            after: {
              unitEntityId: unitId,
              personsCount: m.personsCount,
              effectiveFrom: monthStart.toISOString(),
              source: "reading_round",
              roundId: round.id,
            },
            justification: "person-months applied for the next predpis",
          });
        }
        await tx
          .update(personMonths)
          .set({ appliedUnitPersonsId: appliedId })
          .where(eq(personMonths.id, m.id));
      }
    }
    return { unitsUpdated: byUnit.size, rowsCreated };
  });
}

// ── Photos ─────────────────────────────────────────────

/**
 * Photo visibility (decision 2026-11-18): board (admin / treasurer /
 * chairman) and the owner who SUBMITTED the reading. Building-meter photos:
 * board only. Null = 403 at the route.
 */
export async function resolveReadingPhoto(input: {
  entityId: string;
  kind: "unit" | "building";
  id: string;
  userId: string;
  userRole: string;
}): Promise<{ storageKey: string } | null> {
  const isBoard =
    input.userRole === "admin" ||
    (await hasBoardRole(input.userId, input.entityId, ["treasurer", "chairman"]));
  if (input.kind === "building") {
    if (!isBoard) return null;
    const [row] = await db
      .select({ key: buildingMeterReadings.photoStorageKey })
      .from(buildingMeterReadings)
      .where(
        and(
          eq(buildingMeterReadings.id, input.id),
          eq(buildingMeterReadings.entityId, input.entityId)
        )
      );
    return row?.key ? { storageKey: row.key } : null;
  }
  const [row] = await db
    .select({
      key: meterReadings.photoStorageKey,
      createdById: meterReadings.createdById,
    })
    .from(meterReadings)
    .where(and(eq(meterReadings.id, input.id), eq(meterReadings.entityId, input.entityId)));
  if (!row?.key) return null;
  if (!isBoard && row.createdById !== input.userId) return null;
  return { storageKey: row.key };
}
