import { getTranslations } from "next-intl/server";

import NewPostFlow from "@/components/nastenka/NewPostFlow";
import { PageHeader } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { parseCreateType, type CreateType } from "@/lib/feed";
import { listEntrances } from "@/lib/feed.server";
import { isBoard } from "@/lib/mcp/authz";
import { hasPermission } from "@/lib/permissions";
import { getShellData } from "@/lib/shell.server";

// One create flow for every feed type (BYT-20261117-002 Phase 5).
// `?typ=oznam|udalost|pomoc|predaj` preselects the type (old /komunita/*/nov*
// routes redirect here with it).

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewFeedPostPage({ params, searchParams }: Props) {
  const [{ locale }, sp, session, t] = await Promise.all([
    params,
    searchParams,
    auth(),
    getTranslations("Feed.create"),
  ]);
  if (!session?.user?.id) return null; // the layout already redirects to /login

  const role = session.user.role;
  // Same authority as POST /api/posts (createPost → assertBoard with
  // caretaker): admin, active chairman or caretaker (BYT-20261117-001).
  const shell = await getShellData(session);
  const canNotice =
    shell.user.status === "active" &&
    isBoard({ role, boardRoles: shell.user.boardRoles }, { allowCaretaker: true });
  const canCommunity = hasPermission(role, "createCommunityPost");

  // Board first sees "Oznam"; owners only the resident types.
  const allowed: CreateType[] = [
    ...(canNotice ? (["oznam"] as const) : []),
    ...(canCommunity ? (["udalost", "pomoc", "predaj"] as const) : []),
  ];
  if (allowed.length === 0) {
    redirect({ href: "/board", locale });
    return null;
  }

  const requested = parseCreateType(sp.typ);
  const initialType = requested && allowed.includes(requested) ? requested : null;
  const entrances = canNotice ? await listEntrances() : [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("title")} backHref="/board" backLabel={t("back")} />
      <NewPostFlow
        allowedTypes={allowed}
        initialType={initialType}
        entrances={entrances.length > 1 ? entrances : []}
      />
    </div>
  );
}
