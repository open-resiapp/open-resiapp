// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import KartaDetailClient from "@modules/accounting/src/routes/dashboard/karta/[unitId]/page";

export default async function KartaDetailPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const { unitId } = await params;
  return <KartaDetailClient unitId={unitId} />;
}
