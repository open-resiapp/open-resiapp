// MCP error codes (BYT-20261117-001 §7).
//
// Lib functions reachable from MCP tools throw `McpError(code)` — a stable,
// locale-free code — never prose. The MCP layer turns it into
// `isError: true` + the code; UI routes map it to their existing HTTP status
// (see `mcpErrorStatus`). Pre-existing lib errors (Slovak strings in the
// core / voting routes, "accounting: …" English in the accounting libs) are
// mapped by `toMcpError` so no raw string ever reaches a tool result.
//
// Pure module — no server-only deps — so client code may import the code
// union for i18n lookups.

export type McpErrorCode =
  | "unauthorized"
  | "forbidden"
  | "scope_required"
  | "module_disabled"
  | "not_found"
  | "community_missing"
  | `validation.${string}`
  | "conflict.state_changed"
  | "action_expired"
  | "voting_not_active"
  | "electronic_blocked"
  | "not_unit_owner"
  | "unit_out_of_scope"
  | "rate_limited"
  | "internal";

export class McpError extends Error {
  readonly code: McpErrorCode;
  /** Optional machine-readable context (missing scopes, field name, …). */
  readonly details?: Record<string, unknown>;

  constructor(code: McpErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = "McpError";
    this.code = code;
    this.details = details;
  }
}

export function isMcpError(err: unknown): err is McpError {
  return err instanceof McpError;
}

/** Convenience for `validation.<field>`. */
export function validationError(
  field: string,
  details?: Record<string, unknown>
): McpError {
  return new McpError(`validation.${field}`, details);
}

/** HTTP status a UI route returns for a given code. */
export function mcpErrorStatus(code: McpErrorCode): number {
  if (code === "unauthorized") return 401;
  if (
    code === "forbidden" ||
    code === "scope_required" ||
    code === "unit_out_of_scope"
  ) {
    return 403;
  }
  if (code === "not_found" || code === "module_disabled" || code === "community_missing") {
    return 404;
  }
  if (code === "conflict.state_changed") return 409;
  if (code === "action_expired") return 410;
  if (code === "rate_limited") return 429;
  if (code === "internal") return 500;
  return 400;
}

// ── Mapping of known lib error strings → codes ───────────────────────────
//
// Order matters: first match wins. Patterns are matched against the raw
// `Error.message`. Keep each entry tied to the source that throws/returns it
// so the table can be pruned when a lib switches to McpError.

const MESSAGE_MAP: Array<[RegExp, McpErrorCode]> = [
  // Core / voting route strings (Slovak).
  [/Neautorizovaný prístup/i, "unauthorized"],
  [/Nemáte oprávnenie/i, "forbidden"],
  [/nenájden/i, "not_found"], // "Hlasovanie nenájdené", "Príspevok nenájdený", "Hlas nenájdený"
  [/Hlasovanie nie je aktívne/i, "voting_not_active"],
  [/Hlas je možné stiahnuť len počas aktívneho/i, "voting_not_active"],
  [/Elektronické hlasovanie nie je povolené/i, "electronic_blocked"],
  [/Vlastník nevlastní tento byt/i, "not_unit_owner"],
  [/nie je v hlasovanom rozsahu/i, "unit_out_of_scope"],
  [/Neplatná položka hlasovania/i, "validation.items"],
  [/Neplatná voľba/i, "validation.choice"],
  [/Duplicitná voľba/i, "validation.items"],
  [/Nadpis a obsah sú povinné/i, "validation.title"],
  [/Nadpis, začiatok a koniec sú povinné/i, "validation.title"],
  [/Písomné hlasovanie musí trvať/i, "validation.endsAt"],
  [/Položky nie je možné upraviť/i, "conflict.state_changed"],
  [/community root/i, "community_missing"],

  // Accounting lib strings (English, usually "accounting: …").
  [/already (handled|matched|posted|voided|approved|dismissed)/i, "conflict.state_changed"],
  [/not (pending|unmatched|open)/i, "conflict.state_changed"],
  [/period (is )?(closed|locked)/i, "conflict.state_changed"],
  [/not found/i, "not_found"],
  [/forbidden/i, "forbidden"],
  [/no community/i, "community_missing"],
  [/invalid amount|amount must/i, "validation.amountCents"],
  [/invalid unit/i, "validation.unitEntityId"],
  [/invalid (receivedAt|date)/i, "validation.date"],
  [/receivedAt cannot be in the future/i, "validation.receivedAt"],
  [/invalid method/i, "validation.method"],
  [/invalid meter type/i, "validation.meterType"],
  [/invalid value/i, "validation.valueMilli"],
  [/invalid invoiceDate/i, "validation.invoiceDate"],
  [/invalid okruh/i, "validation.okruh"],
  [/invalid amounts/i, "validation.amounts"],
  [/netto \+ DPH/i, "validation.amountNettoCents"],
  [/^(\w+) required$/i, "validation.required"],
];

/**
 * Normalises anything thrown by a lib function into an McpError. McpErrors
 * pass through; known strings map to their code; everything else becomes
 * `internal` (the raw message is kept in `details.raw` for server logs only
 * — the MCP layer MUST NOT put `details.raw` into a tool result).
 */
export function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) return err;
  const message = err instanceof Error ? err.message : String(err ?? "");
  for (const [re, code] of MESSAGE_MAP) {
    const m = re.exec(message);
    if (!m) continue;
    if (code === "validation.required" && m[1]) {
      return new McpError(`validation.${m[1]}`, { raw: message });
    }
    return new McpError(code, { raw: message });
  }
  return new McpError("internal", { raw: message });
}
