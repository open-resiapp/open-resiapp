// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import DebtorsClient from "@modules/accounting/src/routes/dashboard/debtors/page";

export default async function DebtorsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <DebtorsClient />;
}
