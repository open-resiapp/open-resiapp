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

/** Keeps argument shape for forensics; truncates strings, drops secrets. */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactArgs(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redactArgs(v, depth + 1);
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
