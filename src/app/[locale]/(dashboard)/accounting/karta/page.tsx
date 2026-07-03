// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import KartaListClient from "@modules/accounting/src/routes/dashboard/karta/page";

export default async function KartaPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  return <KartaListClient />;
}
