// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import PredpisListClient from "@modules/accounting/src/routes/dashboard/predpis/page";

export default async function PredpisPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <PredpisListClient />;
}
