// Owned by the voting module — BYT-20261117-002 Phase 6. Public page (no
// session needed: the link may be opened on another device); the signed
// token in `?t=` identifies the voter and the ballot.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import VoteConfirmPage from "@modules/voting/src/routes/confirm/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  if (!(await isModuleEnabled("voting"))) notFound();
  const { t } = await searchParams;
  return <VoteConfirmPage token={typeof t === "string" ? t : null} />;
}
