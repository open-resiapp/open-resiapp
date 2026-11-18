// Owned by the faults module — BYT-20261118-004.
import { notFound } from "next/navigation";

import { isModuleEnabled } from "@/lib/modules/route-guard";
import FaultDetailPage from "@modules/faults/src/routes/dashboard/detail";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  if (!(await isModuleEnabled("faults"))) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <FaultDetailPage id={id} justCreated={sp.nove === "1"} />;
}
