// Owned by the voting module — BYT-20261118-001 §3. Public page (no session):
// the signed token in `?t=` identifies the owner and the meeting; `?s=` is
// the answer picked in the e-mail. Rendering never writes — the owner taps
// "Potvrdiť" (mail scanners prefetch links).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import MeetingRsvpPage from "@modules/voting/src/routes/meeting-rsvp/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; s?: string | string[] }>;
}) {
  if (!(await isModuleEnabled("voting"))) notFound();
  const { t, s } = await searchParams;
  return (
    <MeetingRsvpPage
      token={typeof t === "string" ? t : null}
      suggested={typeof s === "string" ? s : null}
    />
  );
}
