// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import InspectClient from "@modules/accounting/src/routes/dashboard/inspect/page";

export default async function InspectPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <InspectClient />;
}
