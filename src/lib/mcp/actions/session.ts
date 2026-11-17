import "server-only";

import type { Session } from "next-auth";

import { listEnabledModules } from "@/lib/modules/route-guard";
import { getPublicOrigin } from "../config";
import { principalContextFromSession } from "../principal";
import { clientDisplayName } from "./service";
import type { ActionContext } from "./types";

// ActionContext for the in-app fallback confirm page (§5 step 5): the
// NextAuth session of the user who owns the pending action. Role, board
// roles and status are read live, exactly like the MCP path; the audit
// justification keeps the name of the AI client that proposed the action.

export async function actionContextFromSession(
  session: Session,
  proposingClientId: string | null
): Promise<ActionContext> {
  const [{ principal, root }, modules, clientName] = await Promise.all([
    principalContextFromSession(session),
    listEnabledModules(),
    clientDisplayName(proposingClientId),
  ]);
  return {
    principal,
    root,
    enabledModules: new Set(modules),
    clientName,
    origin: getPublicOrigin(),
    numberLocale: root.country === "cz" ? "cs-CZ" : "sk-SK",
  };
}
