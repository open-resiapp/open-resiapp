// Owned by the voting module — RES-20260505-001.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import VotingNewClient from "@modules/voting/src/routes/dashboard/new/page";

export default async function VotingNewPage() {
  if (!(await isModuleEnabled("voting"))) notFound();
  return <VotingNewClient />;
}
