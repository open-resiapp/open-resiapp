// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import AccountingSettingsClient from "@modules/accounting/src/routes/dashboard/settings/page";

export default async function AccountingSettingsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <AccountingSettingsClient />;
}
