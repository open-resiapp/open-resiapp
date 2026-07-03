// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleListUnits } from "@modules/accounting/src/routes/api/karta-bytu";

export const GET = withModuleEnabled("accounting", handleListUnits);
