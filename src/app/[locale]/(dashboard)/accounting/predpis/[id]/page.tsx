// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import PredpisEditorClient from "@modules/accounting/src/routes/dashboard/predpis/[id]/page";

export default async function PredpisEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const { id } = await params;
  return <PredpisEditorClient scheduleId={id} />;
}
