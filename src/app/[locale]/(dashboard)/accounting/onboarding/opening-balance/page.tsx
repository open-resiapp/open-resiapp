// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import OpeningBalanceClient from "@modules/accounting/src/routes/dashboard/onboarding/opening-balance/page";

export default async function OpeningBalancePage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <OpeningBalanceClient />;
}
