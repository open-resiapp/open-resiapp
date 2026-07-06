// Owned by the accounting module — BYT-20260512-002 (AC 478/479).
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import InboxClient from "@modules/accounting/src/routes/dashboard/inbox/page";

export default async function ExpenseInboxPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <InboxClient />;
}
