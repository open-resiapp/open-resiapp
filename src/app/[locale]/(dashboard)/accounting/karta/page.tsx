// Owned by the accounting module — BYT-20260512-002.
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { canReadAccounting } from "@modules/accounting/src/lib/authz";
import { listAccessibleUnits } from "@modules/accounting/src/lib/karta-bytu";
import KartaListClient from "@modules/accounting/src/routes/dashboard/karta/page";

export default async function KartaPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();

  // BYT-20261117-002 Phase 4: an owner with exactly one unit never sees a
  // unit list — "Moje platby" is their card. Whole-dom readers (board)
  // get every unit from listAccessibleUnits, so they keep the list.
  const [session, root] = await Promise.all([auth(), getCommunityRoot()]);
  if (session?.user?.id && root) {
    const { id, role } = session.user;
    const wholeDom = await canReadAccounting(id, role as string, root.id);
    const units = wholeDom ? [] : await listAccessibleUnits(id, role as string, root.id);
    if (units.length === 1) {
      redirect({ href: "/moje-platby", locale: await getLocale() });
    }
  }

  return <KartaListClient />;
}
