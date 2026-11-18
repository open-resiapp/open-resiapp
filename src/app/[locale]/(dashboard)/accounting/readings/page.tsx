// Owned by the accounting module — BYT-20261118-006 (reading rounds).
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import ReadingsBoardClient from "@modules/accounting/src/routes/dashboard/readings/page";

export default async function ReadingsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <ReadingsBoardClient />;
}
