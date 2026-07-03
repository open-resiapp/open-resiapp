// Owned by the accounting module — BYT-20260512-002.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleList,
  handleCreate,
} from "@modules/accounting/src/routes/api/fee-schedules";

export const GET = withModuleEnabled("accounting", handleList);
export const POST = withModuleEnabled("accounting", handleCreate);
