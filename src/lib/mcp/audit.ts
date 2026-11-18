import "server-only";

import { lt } from "drizzle-orm";

import { db } from "@/db";
import { mcpAuditLog } from "@/db/schema";

// MCP audit log (BYT-20261117-001 §7): one row per tools/call — including
// calls refused by authz / scope / validation — plus one row per web
// confirm / cancel of a pending action (fallback page, tool "web:*"). Fire-and-forget like
// logExternalApiRequest; 90-day retention via probabilistic pruning.

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SECRET_KEY_RE = /token|secret|password|code_verifier|authorization/i;
const MAX_STRING = 120;
// Personal data of third parties (owners in import_owners / assign_unit_owner
// …): kept out of the 90-day audit trail. Matches `name`, `owner_name`,
// `email`, `owner_phone`, `iban`, `birthDate` … (key or snake/camel suffix).
const PII_KEY_RE =
  /(name|email|e_mail|phone|mobile|address|street|city|zip|postal_code|iban|bic|account_number|birth|birth_date|birthdate|personal_id|rodne_cislo|national_id)$/i;

function isPiiKey(k: string): boolean {
  // Suffix match: also catches "fileName" / "tool_name" — a false positive
  // only loses a value in the audit row, never the call.
  return PII_KEY_RE.test(k);
}

function hasPiiKey(v: unknown): boolean {
  return (
    !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).some(isPiiKey)
  );
}

/**
 * Keeps argument shape for forensics; truncates strings, drops secrets and
 * personal data. An array of person-like objects is stored as shape only
 * ({ count, keys }) — no cell values at all.
 */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    if (value.some(hasPiiKey)) {
      const keys = new Set<string>();
      for (const row of value) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          for (const k of Object.keys(row as object).slice(0, 30)) keys.add(k);
        }
      }
      return { "[rows]": value.length, keys: [...keys].sort().slice(0, 30) };
    }
    return value.slice(0, 20).map((v) => redactArgs(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      if (SECRET_KEY_RE.test(k)) out[k] = "[redacted]";
      else if (isPiiKey(k) && v !== null && v !== undefined && v !== "") out[k] = "[pii]";
      else out[k] = redactArgs(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function logMcpCall(entry: {
  userId: string | null;
  clientId: string | null;
  tool: string;
  args: unknown;
  resultCode: string;
  durationMs: number;
  /** Pending action proposed / confirmed / cancelled by this call (§5). */
  pendingActionId?: string | null;
}): void {
  db.insert(mcpAuditLog)
    .values({
      userId: entry.userId,
      clientId: entry.clientId,
      tool: entry.tool.slice(0, 64),
      argsRedacted: redactArgs(entry.args ?? null) as Record<string, unknown> | null,
      resultCode: entry.resultCode.slice(0, 64),
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      pendingActionId: entry.pendingActionId ?? null,
    })
    .then(() => {
      if (Math.random() < 0.01) {
        db.delete(mcpAuditLog)
          .where(lt(mcpAuditLog.createdAt, new Date(Date.now() - RETENTION_MS)))
          .then(() => {})
          .catch(() => {});
      }
    })
    .catch((err) => console.error("[mcp] audit insert failed:", err));
}
