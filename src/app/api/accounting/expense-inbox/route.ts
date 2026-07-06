// Owned by the accounting module — BYT-20260512-002 (AC 478/479).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleUpload,
  handleList,
} from "@modules/accounting/src/routes/api/expense-inbox";

export const GET = withModuleEnabled("accounting", handleList);
export const POST = withModuleEnabled("accounting", handleUpload);
