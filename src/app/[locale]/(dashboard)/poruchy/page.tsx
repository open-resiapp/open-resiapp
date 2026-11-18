// Owned by the faults module — BYT-20261118-004.
import { notFound } from "next/navigation";

import { isModuleEnabled } from "@/lib/modules/route-guard";
import FaultsPage from "@modules/faults/src/routes/dashboard/list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  if (!(await isModuleEnabled("faults"))) notFound();
  return <FaultsPage searchParams={await searchParams} />;
}
