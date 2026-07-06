// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleIcs } from "@modules/accounting/src/routes/api/revisions";

export const GET = withModuleEnabled("accounting", handleIcs);
