// Owned by the voting module — RES-20260505-001.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { sessionIsBoard } from "@/lib/mcp/authz";
import VotingListClient from "@modules/voting/src/routes/dashboard/page";

export default async function VotingListPage() {
  if (!(await isModuleEnabled("voting"))) notFound();
  // BYT-20261117-001 Decided 1: admin OR active chairman may create.
  return <VotingListClient canCreate={await sessionIsBoard()} />;
}
