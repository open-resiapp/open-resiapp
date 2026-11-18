// Owned by the accounting module — BYT-20261118-001.
import { withModuleEnabled } from "@/lib/modules/route-guard";
import {
  handleDeleteCredentials,
  handleSaveCredentials,
} from "@modules/accounting/src/routes/api/enable-banking";

export const PUT = withModuleEnabled("accounting", handleSaveCredentials);
export const DELETE = withModuleEnabled("accounting", handleDeleteCredentials);
