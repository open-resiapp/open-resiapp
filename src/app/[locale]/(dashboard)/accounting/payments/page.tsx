// Owned by the accounting module — BYT-20260512-002.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import PaymentsClient from "@modules/accounting/src/routes/dashboard/payments/page";

export default async function PaymentsPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  // Suspense boundary required by the client's useSearchParams (?unit=).
  return (
    <Suspense>
      <PaymentsClient />
    </Suspense>
  );
}
