// Owned by the voting module — RES-20260505-001.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import VotingListClient from "@modules/voting/src/routes/dashboard/page";

export default async function VotingListPage() {
  if (!(await isModuleEnabled("voting"))) notFound();
  return <VotingListClient />;
}
