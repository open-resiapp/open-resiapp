// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import JournalClient from "@modules/accounting/src/routes/dashboard/journal/page";

export default async function JournalPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <JournalClient />;
}
