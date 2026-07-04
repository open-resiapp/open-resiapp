// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import ReconciliationClient from "@modules/accounting/src/routes/dashboard/reconciliation/page";

export default async function ReconciliationPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <ReconciliationClient />;
}
