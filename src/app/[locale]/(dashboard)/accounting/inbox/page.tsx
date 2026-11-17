// Owned by the accounting module — BYT-20260512-002 / BYT-20261117-002.
// The invoice inbox is now the "Na spracovanie" section of Faktúry a výdavky.
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { redirect } from "@/i18n/navigation";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const { locale } = await params;
  redirect({ href: "/accounting/expenses", locale });
}
