// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import MetersClient from "@modules/accounting/src/routes/dashboard/meters/page";

export default async function MetersPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <MetersClient />;
}
