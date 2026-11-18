// Owned by the accounting module — bulk upomienky (one PDF, page per debtor).
import { withModuleEnabled } from "@/lib/modules/route-guard";
import { handleUpomienkyPdfData } from "@modules/accounting/src/routes/api/debtors";

export const GET = withModuleEnabled("accounting", handleUpomienkyPdfData);
