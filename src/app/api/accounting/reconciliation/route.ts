// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleListUnmatched } from "@modules/accounting/src/routes/api/bank-import";

export const GET = withModuleEnabled("accounting", handleListUnmatched);
