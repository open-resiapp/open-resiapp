// Owned by the accounting module — BYT-20260512-002 / BYT-20261117-002.
// Bank reconciliation now lives in the "Z banky" tab of Platby od vlastníkov.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { redirect } from "@/i18n/navigation";

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const { locale } = await params;
  redirect({ href: "/accounting/payments?tab=bank", locale });
}
