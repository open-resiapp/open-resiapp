// Owned by the voting module — BYT-20261117-002 Phase 6. Withdraw e-mail
// link page. Since BYT-20261118-009 it requires a session of the token's
// voter (the token binds the ballot, the session binds the person); vote
// confirmation links go to /<locale>/voting/confirm/<token> instead.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import VoteConfirmPage from "@modules/voting/src/routes/confirm/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  if (!(await isModuleEnabled("voting"))) notFound();
  const { locale } = await params;
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : null;

  const session = await auth();
  if (!session?.user?.id) {
    const back = `/${locale}/vote-confirm${token ? `?t=${encodeURIComponent(token)}` : ""}`;
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(back)}`);
  }
  return <VoteConfirmPage token={token} viewerId={session.user.id} />;
}
