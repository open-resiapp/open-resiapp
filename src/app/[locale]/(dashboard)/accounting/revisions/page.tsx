// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import RevisionsClient from "@modules/accounting/src/routes/dashboard/revisions/page";

export default async function RevisionsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <RevisionsClient />;
}
