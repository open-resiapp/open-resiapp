import { redirect } from "@/i18n/navigation";

// Old "Vlastníci bez účtu" page — now a filter of /owners (BYT-20261117-002).
export default async function PendingShellUsersRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/owners?status=no_account", locale });
}
