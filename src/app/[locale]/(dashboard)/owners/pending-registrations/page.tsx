import { redirect } from "@/i18n/navigation";

// Old approval queue — now the "Čaká na vás" inbox on /owners (BYT-20261117-002).
export default async function PendingRegistrationsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/owners#inbox", locale });
}
