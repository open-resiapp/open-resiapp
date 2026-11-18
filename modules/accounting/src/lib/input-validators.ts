// Shared request-body validators for accounting writes (BYT-20261117-001 §3).
// Used by the UI API routes AND (later) the MCP write tools, so a field the
// route rejects is rejected identically on the AI path.
//
// Each validator returns `{ ok: false, field, code }` on the first failed
// rule. `code` is a stable InputErrorCode (never prose): the HTTP routes map
// it to the `Accounting.inputErrors.<code>` catalog entry
// (input-errors.server.ts), the MCP tools turn `field` into the
// `validation.<field>` code.
//
// Pure apart from the METER_TYPES constant import.

import { METER_TYPES, type MeterType } from "./meters";

export const INPUT_ERROR_CODES = [
  "required",
  "invalid_amount",
  "invalid_amounts",
  "invalid_date",
  "future_date",
  "invalid_okruh",
  "netto_dph_required",
  "netto_dph_mismatch",
  "invalid_unit",
  "invalid_method",
  "invalid_meter_type",
  "invalid_value",
] as const;
export type InputErrorCode = (typeof INPUT_ERROR_CODES)[number];

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; field: string; code: InputErrorCode };

const fail = (field: string, code: InputErrorCode) =>
  ({ ok: false, field, code }) as const;

const reqStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

const optInt = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : Number(v);

const optDate = (v: unknown) =>
  typeof v === "string" && v ? new Date(v) : null;

const optId = (v: unknown) => (typeof v === "string" && v ? v : null);

// ── Expense (create + post-from-inbox) ───────────────────────────────────

export interface ExpenseInput {
  supplierName: string;
  supplierIco: string;
  supplierDic: string;
  supplierIban: string;
  invoiceNo: string;
  invoiceDate: Date;
  dueDate: Date | null;
  serviceCategoryId: string | null;
  okruh: "fpuo" | "svc";
  amountCents: number;
  amountNettoCents: number;
  dphCents: number;
  dphRateBp: number | null;
  nextInspectionDueAt: Date | null;
  isRecurring: boolean;
  /** Only meaningful for a direct create (expense authorisation link). */
  authorisationId: string | null;
}

/**
 * Supplier-invoice (účtovný doklad) fields — AC 440: full identifying set
 * non-empty, netto + DPH present and tying out to brutto. Enforced at every
 * human/AI entry surface; the lib stays booking-integrity only.
 */
export function validateExpenseInput(
  body: Record<string, unknown>
): ValidationResult<ExpenseInput> {
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return fail("amountCents", "invalid_amount");
  }
  const requiredStrings: Array<[string, unknown]> = [
    ["supplierName", body.supplierName],
    ["supplierIco", body.supplierIco],
    ["supplierDic", body.supplierDic],
    ["supplierIban", body.supplierIban],
    ["invoiceNo", body.invoiceNo],
  ];
  for (const [field, value] of requiredStrings) {
    if (!reqStr(value)) return fail(field, "required");
  }
  const invoiceDate = new Date(String(body.invoiceDate ?? ""));
  if (Number.isNaN(invoiceDate.getTime())) {
    return fail("invoiceDate", "invalid_date");
  }
  const okruh = body.okruh === "fpuo" ? "fpuo" : body.okruh === "svc" ? "svc" : null;
  if (!okruh) return fail("okruh", "invalid_okruh");

  const amountNettoCents = optInt(body.amountNettoCents);
  const dphCents = optInt(body.dphCents);
  const dphRateBp = optInt(body.dphRateBp);
  for (const [field, n] of [
    ["amountNettoCents", amountNettoCents],
    ["dphCents", dphCents],
    ["dphRateBp", dphRateBp],
  ] as Array<[string, number | null]>) {
    if (n !== null && !Number.isInteger(n)) return fail(field, "invalid_amounts");
  }
  if (amountNettoCents === null || dphCents === null) {
    return fail(
      amountNettoCents === null ? "amountNettoCents" : "dphCents",
      "netto_dph_required"
    );
  }
  if (amountNettoCents + dphCents !== amountCents) {
    return fail("amountNettoCents", "netto_dph_mismatch");
  }

  return {
    ok: true,
    value: {
      supplierName: String(body.supplierName).trim(),
      supplierIco: String(body.supplierIco).trim(),
      supplierDic: String(body.supplierDic).trim(),
      supplierIban: String(body.supplierIban).trim(),
      invoiceNo: String(body.invoiceNo).trim(),
      invoiceDate,
      dueDate: optDate(body.dueDate),
      serviceCategoryId: optId(body.serviceCategoryId),
      okruh,
      amountCents,
      amountNettoCents,
      dphCents,
      dphRateBp,
      nextInspectionDueAt: optDate(body.nextInspectionDueAt),
      isRecurring: body.isRecurring === true,
      authorisationId: optId(body.authorisationId),
    },
  };
}

// ── Manual payment ───────────────────────────────────────────────────────

export interface ManualPaymentInput {
  unitEntityId: string;
  amountCents: number;
  receivedAt: Date;
  method: "bank" | "cash";
  note: string | undefined;
}

export function validateManualPaymentInput(
  body: Record<string, unknown>,
  now: Date = new Date()
): ValidationResult<ManualPaymentInput> {
  if (typeof body.unitEntityId !== "string") {
    return fail("unitEntityId", "invalid_unit");
  }
  const method = body.method ?? "bank";
  if (method !== "bank" && method !== "cash") {
    return fail("method", "invalid_method");
  }
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return fail("amountCents", "invalid_amount");
  }
  const receivedAt = body.receivedAt ? new Date(String(body.receivedAt)) : now;
  if (Number.isNaN(receivedAt.getTime())) {
    return fail("receivedAt", "invalid_date");
  }
  if (receivedAt.getTime() > now.getTime() + 24 * 3600 * 1000) {
    return fail("receivedAt", "future_date");
  }
  return {
    ok: true,
    value: {
      unitEntityId: body.unitEntityId,
      amountCents,
      receivedAt,
      method,
      note: typeof body.note === "string" ? body.note : undefined,
    },
  };
}

// ── Meter reading ────────────────────────────────────────────────────────

export interface MeterReadingInput {
  unitEntityId: string;
  meterType: MeterType;
  readingDate: Date;
  valueMilli: number;
}

export function validateMeterReadingInput(
  body: Record<string, unknown>
): ValidationResult<MeterReadingInput> {
  if (typeof body.unitEntityId !== "string") {
    return fail("unitEntityId", "invalid_unit");
  }
  if (!METER_TYPES.includes(body.meterType as MeterType)) {
    return fail("meterType", "invalid_meter_type");
  }
  const valueMilli = Number(body.valueMilli);
  if (!Number.isInteger(valueMilli) || valueMilli < 0) {
    return fail("valueMilli", "invalid_value");
  }
  const readingDate = new Date(String(body.readingDate ?? ""));
  if (Number.isNaN(readingDate.getTime())) {
    return fail("readingDate", "invalid_date");
  }
  return {
    ok: true,
    value: {
      unitEntityId: body.unitEntityId,
      meterType: body.meterType as MeterType,
      readingDate,
      valueMilli,
    },
  };
}

// ── Reconciliation match ─────────────────────────────────────────────────

export interface MatchInput {
  unitEntityId: string;
}

export function validateMatchInput(
  body: Record<string, unknown>
): ValidationResult<MatchInput> {
  if (typeof body.unitEntityId !== "string") {
    return fail("unitEntityId", "invalid_unit");
  }
  return { ok: true, value: { unitEntityId: body.unitEntityId } };
}
