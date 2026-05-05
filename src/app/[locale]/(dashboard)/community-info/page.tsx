import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { building, boardMembers, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import PendingStatusPoller from "@/components/community-info/PendingStatusPoller";

export default async function CommunityInfoPage() {
  const session = await auth();
  if (!session) redirect({ href: "/login", locale: "sk" });

  const t = await getTranslations("CommunityInfo");

  const [buildingRow] = await db.select().from(building).limit(1);

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
            eq(boardMembers.buildingId, buildingRow.id),
            eq(boardMembers.isActive, true)
          )
        )
    : [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PendingStatusPoller />
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold text-base">{t("pendingHeading")}</p>
        <p className="mt-1 text-sm">{t("pendingBody")}</p>
      </div>

      {buildingRow ? (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">
            {buildingRow.name}
          </h1>
          <p className="mt-1 text-base text-gray-600">{buildingRow.address}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          {t("boardHeading")}
        </h2>
        {board.length === 0 ? (
          <p className="mt-3 text-base text-gray-500">{t("boardEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {board.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between text-base text-gray-800"
              >
                <span className="font-medium">{member.name}</span>
                <span className="text-sm text-gray-500">
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
