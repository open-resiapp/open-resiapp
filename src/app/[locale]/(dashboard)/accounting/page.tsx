// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import AccountingHomeClient from "@modules/accounting/src/routes/dashboard/accounting/page";

export default async function AccountingPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <AccountingHomeClient />;
}
