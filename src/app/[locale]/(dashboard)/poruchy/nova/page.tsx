// Owned by the faults module — BYT-20261118-004.
import { notFound } from "next/navigation";

import { isModuleEnabled } from "@/lib/modules/route-guard";
import NewFaultPage from "@modules/faults/src/routes/dashboard/new";

export default async function Page() {
  if (!(await isModuleEnabled("faults"))) notFound();
  return <NewFaultPage />;
}
