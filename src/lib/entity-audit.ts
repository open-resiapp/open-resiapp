import { db } from "@/db";
import { entityAuditLog, type entityAuditActionEnum } from "@/db/schema";

type EntityAuditAction = (typeof entityAuditActionEnum.enumValues)[number];

interface RecordParams {
  action: EntityAuditAction;
  actorUserId: string | null;
  entityId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Append-only audit log entry for an operator-side mutation of the
 * entity tree or a membership. Fire-and-forget; never blocks the
 * caller. Failures are logged but do not surface as request errors.
 *
 * Spec: RES-20260501-002 §"Operator-only mutation surface" + Notes.
 */
export function recordEntityAudit(params: RecordParams): void {
  db.insert(entityAuditLog)
    .values({
      action: params.action,
      actorUserId: params.actorUserId,
      entityId: params.entityId,
      beforeJson: params.before ? JSON.stringify(params.before) : null,
      afterJson: params.after ? JSON.stringify(params.after) : null,
    })
    .catch((err) => {
      console.error("[entity-audit] failed to record entry:", err);
    });
}
