// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleSync } from "@modules/accounting/src/routes/api/fio";

export const POST = withModuleEnabled("accounting", handleSync);
