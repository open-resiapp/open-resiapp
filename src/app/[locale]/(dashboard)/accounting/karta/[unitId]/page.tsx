// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import KartaDetailClient from "@modules/accounting/src/routes/dashboard/karta/[unitId]/page";
import UnitNoteCard from "@/components/unit-notes/UnitNoteCard";

export default async function KartaDetailPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const { unitId } = await params;
  // BYT-20261118-005: board-only unit note (renders nothing for non-board).
  return (
    <>
      <div className="mb-4">
        <UnitNoteCard entityId={unitId} defaultCollapsed />
      </div>
      <KartaDetailClient unitId={unitId} />
    </>
  );
}
