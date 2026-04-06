import { db } from "@/db";
import { externalApiLogs } from "@/db/schema";
import { lt } from "drizzle-orm";

type AuthResult =
  | "success"
  | "invalid_key"
  | "insufficient_permission"
  | "rate_limited"
  | "unauthenticated";

interface LogParams {
  connectionId?: string;
  endpoint: string;
  method: string;
  ipAddress?: string;
  userAgent?: string;
  statusCode: number;
  authResult: AuthResult;
  responseTimeMs?: number;
}

export function logExternalApiRequest(params: LogParams) {
  // Fire-and-forget — don't block the response
  db.insert(externalApiLogs)
    .values({
      connectionId: params.connectionId || null,
      endpoint: params.endpoint,
      method: params.method,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      statusCode: params.statusCode,
      authResult: params.authResult,
      responseTimeMs: params.responseTimeMs || null,
    })
    .then(() => {
      // Probabilistic cleanup: ~1% chance on each insert
      if (Math.random() < 0.01) {
        const ninetyDaysAgo = new Date(
          Date.now() - 90 * 24 * 60 * 60 * 1000
        );
        db.delete(externalApiLogs)
          .where(lt(externalApiLogs.createdAt, ninetyDaysAgo))
          .then(() => {})
          .catch(() => {});
      }
    })
    .catch(() => {});
}
