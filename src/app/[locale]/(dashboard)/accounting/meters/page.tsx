// Owned by the accounting module — BYT-20260512-002.
// BYT-20261118-006: the old meters page is replaced by the reading rounds —
// board → Financie → Ročné úlohy → Odpočty a osoby (/accounting/readings),
// everyone else → Moje platby › Odpočty a osoby. Kept as a redirect so old
// links / bookmarks never 404.
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { canReadAccounting } from "@modules/accounting/src/lib/authz";

export default async function MetersPage() {
  if (!(await isModuleEnabled("accounting"))) notFound();
  const [session, root, locale] = await Promise.all([auth(), getCommunityRoot(), getLocale()]);
  const board =
    session?.user?.id && root
      ? await canReadAccounting(session.user.id, session.user.role as string, root.id)
      : false;
  redirect({ href: board ? "/accounting/readings" : "/moje-platby#odpocty", locale });
}
