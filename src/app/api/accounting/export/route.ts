// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleExport } from "@modules/accounting/src/routes/api/export";

export const GET = withModuleEnabled("accounting", handleExport);
