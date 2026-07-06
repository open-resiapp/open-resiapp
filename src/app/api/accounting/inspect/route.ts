// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleInspect } from "@modules/accounting/src/routes/api/attachments";

export const GET = withModuleEnabled("accounting", handleInspect);
