// Owned by the voting module — RES-20260505-001.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import VotingDetailClient from "@modules/voting/src/routes/dashboard/id/page";

export default async function VotingDetailPage() {
  if (!(await isModuleEnabled("voting"))) notFound();
  return <VotingDetailClient />;
}
