import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import PendingStatusPoller from "@/components/community-info/PendingStatusPoller";
import { getCommunityRoot } from "@/lib/legacy-compat";

export default async function CommunityInfoPage() {
  const session = await auth();
  if (!session) redirect({ href: "/login", locale: "sk" });

  const t = await getTranslations("CommunityInfo");

  const buildingRow = await getCommunityRoot();

  const board = buildingRow
    ? await db
        .select({
          id: boardMembers.id,
          role: boardMembers.role,
          name: users.name,
        })
        .from(boardMembers)
        .innerJoin(users, eq(boardMembers.userId, users.id))
        .where(
          and(
            eq(boardMembers.entityId, buildingRow.id),
            eq(boardMembers.isActive, true)
          )
        )
    : [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PendingStatusPoller />
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
        <p className="font-semibold text-base">{t("pendingHeading")}</p>
        <p className="mt-1 text-sm">{t("pendingBody")}</p>
      </div>

      {buildingRow ? (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:shadow-black/20">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {buildingRow.name}
          </h1>
          <p className="mt-1 text-base text-gray-600 dark:text-gray-300">{buildingRow.address}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:shadow-black/20">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("boardHeading")}
        </h2>
        {board.length === 0 ? (
          <p className="mt-3 text-base text-gray-500 dark:text-gray-400">{t("boardEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {board.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between text-base text-gray-800 dark:text-gray-200"
              >
                <span className="font-medium">{member.name}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t(`role.${member.role}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
