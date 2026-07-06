// Owned by the accounting module — BYT-20260512-002 (AC 417, metadata only).
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import TransfersClient from "@modules/accounting/src/routes/dashboard/transfers/page";

export default async function OkruhTransfersPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <TransfersClient />;
}
