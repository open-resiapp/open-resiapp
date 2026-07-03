// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import UnitVsClient from "@modules/accounting/src/routes/dashboard/predpis/unit-settings/page";

export default async function UnitVsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <UnitVsClient />;
}
