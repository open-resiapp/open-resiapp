// Owned by the accounting module — BYT-20260512-002 / BYT-20261117-002.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import PaymentsClient from "@modules/accounting/src/routes/dashboard/payments/page";
import { hasBankData } from "@modules/accounting/src/routes/dashboard/payments/has-bank-data.server";

export default async function PaymentsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  // Default tab: "Z banky" once the dom imports bank statements or has Fio.
  const bank = await hasBankData();
  // Suspense boundary required by the client's useSearchParams (?unit=, ?tab=).
  return (
    <Suspense>
      <PaymentsClient hasBankData={bank} />
    </Suspense>
  );
}
