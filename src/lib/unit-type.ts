// Unit type ("typ priestoru") of a `unit` entity — client-safe, pure.
//
// Stored in `entities.data.unit_type` (jsonb, no column / migration). An
// absent value is read as "flat" everywhere (back-compat for every unit
// created before this field existed), but `isUnitTypeSet` stays false so the
// owner-data health check (`unit_type_unset`) can ask the board to classify
// the units once.
//
// Voting weight is NOT derived from the unit type: SK zák. 182/1993 §14(3)
// gives ONE vote per flat AND per non-residential unit (garages included), so
// every unit votes regardless of its type. The type only drives display
// (badges), the LV import and optional export filters (attendance sheet).

export const UNIT_TYPES = ["flat", "non_residential", "garage", "other"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** Read-time default for units without a stored type. */
export const DEFAULT_UNIT_TYPE: UnitType = "flat";

export function isUnitType(v: unknown): v is UnitType {
  return typeof v === "string" && (UNIT_TYPES as readonly string[]).includes(v);
}

/** Accepts the entity `data` object or the raw `unit_type` value. */
function rawType(data: unknown): unknown {
  if (data && typeof data === "object") return (data as Record<string, unknown>).unit_type;
  return data;
}

/** The unit's type; unknown / absent → "flat". */
export function getUnitType(data: unknown): UnitType {
  const v = rawType(data);
  return isUnitType(v) ? v : DEFAULT_UNIT_TYPE;
}

/** True when the board (or the LV import) stored a valid type. */
export function isUnitTypeSet(data: unknown): boolean {
  return isUnitType(rawType(data));
}

/** Residential = flat. Non-residential units and garages are not. */
export function isResidentialUnit(data: unknown): boolean {
  return getUnitType(data) === "flat";
}
