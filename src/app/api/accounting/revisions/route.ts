// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleList } from "@modules/accounting/src/routes/api/revisions";

export const GET = withModuleEnabled("accounting", handleList);
