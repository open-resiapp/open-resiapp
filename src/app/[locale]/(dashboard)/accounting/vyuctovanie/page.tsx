// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import VyuctovanieClient from "@modules/accounting/src/routes/dashboard/vyuctovanie/page";

export default async function VyuctovaniePage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <VyuctovanieClient />;
}
