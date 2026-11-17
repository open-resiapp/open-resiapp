import "server-only";

import { McpError } from "@/lib/mcp/errors";
import { assertActive } from "@/lib/mcp/authz";
import type { Principal } from "@/lib/mcp/principal";
import {
  isAccountingApprover,
  isAccountingReader,
  isAccountingWriter,
} from "./authz";
import { canReadUnitLedger } from "./karta-bytu";

// Principal-based accounting asserts (BYT-20261117-001 §3). Same role sets as
// canReadAccounting / canWriteAccounting / canApproveAccounting (./authz),
// evaluated on the Principal's already-loaded `boardRoles` — no extra DB
// round-trip. Throw McpError("forbidden"), never a NextResponse.

/** Treasurer / chairman / admin — whole-dom financial reads. */
export function assertReader(p: Principal): void {
  assertActive(p);
  if (!isAccountingReader(p.role, p.boardRoles)) throw new McpError("forbidden");
}

/** Treasurer / admin — accounting writes. */
export function assertWriter(p: Principal): void {
  assertActive(p);
  if (!isAccountingWriter(p.role, p.boardRoles)) throw new McpError("forbidden");
}

/** Chairman / admin — approvals (závierka). Never the treasurer. */
export function assertApprover(p: Principal): void {
  assertActive(p);
  if (!isAccountingApprover(p.role, p.boardRoles)) throw new McpError("forbidden");
}

/** Whole dom for readers, own units (active owner membership) otherwise. */
export async function assertUnitLedger(
  p: Principal,
  unitEntityId: string
): Promise<void> {
  assertActive(p);
  const ok = await canReadUnitLedger(p.userId, p.role, p.entityId, unitEntityId);
  if (!ok) throw new McpError("forbidden");
}
