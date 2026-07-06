// Owned by the accounting module — BYT-20260512-002 (AC 417, metadata only).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleList,
  handleCreate,
} from "@modules/accounting/src/routes/api/okruh-transfers";

export const GET = withModuleEnabled("accounting", handleList);
export const POST = withModuleEnabled("accounting", handleCreate);
