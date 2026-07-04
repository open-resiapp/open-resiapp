// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import ExpensesClient from "@modules/accounting/src/routes/dashboard/expenses/page";

export default async function ExpensesPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <ExpensesClient />;
}
