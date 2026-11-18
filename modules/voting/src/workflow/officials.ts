// BYT-20261118-002 §2 — officials printed on the voting documents
// (§14a ods. 4: ≥2 verifiers confirm the ballot signatures; §14a ods. 8:
// chair, recorder, verifiers sign the minutes). Pure normaliser; codes only.

export type OfficialRole = "chair" | "recorder" | "verifier";
export const OFFICIAL_ROLES: OfficialRole[] = ["chair", "recorder", "verifier"];

export interface OfficialInput {
  role: OfficialRole;
  name: string;
  userId: string | null;
  refusedToSign: boolean;
  refusalStatement: string | null;
}

export type OfficialsErrorCode = "OFFICIALS_INVALID" | "NOTICE_VERIFIERS_REQUIRED";

/** Minimum verifiers for a written vote (§14a ods. 4). */
export const MIN_VERIFIERS = 2;

export function normalizeOfficials(
  raw: unknown
): { officials: OfficialInput[] } | { error: OfficialsErrorCode } {
  if (!Array.isArray(raw)) return { error: "OFFICIALS_INVALID" };
  const out: OfficialInput[] = [];
  for (const r of raw.slice(0, 20)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const role = o.role as OfficialRole;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 255) : "";
    if (!OFFICIAL_ROLES.includes(role) || !name) return { error: "OFFICIALS_INVALID" };
    out.push({
      role,
      name,
      userId: typeof o.userId === "string" && o.userId ? o.userId : null,
      refusedToSign: o.refusedToSign === true,
      refusalStatement:
        o.refusedToSign === true && typeof o.refusalStatement === "string" && o.refusalStatement.trim()
          ? o.refusalStatement.trim().slice(0, 4000)
          : null,
    });
  }
  return { officials: out };
}

/** Verifier count check for the documents step. Null when fine. */
export function checkVerifiers(officials: { role: OfficialRole }[]): OfficialsErrorCode | null {
  return officials.filter((o) => o.role === "verifier").length >= MIN_VERIFIERS
    ? null
    : "NOTICE_VERIFIERS_REQUIRED";
}
