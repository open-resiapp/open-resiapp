import { redirect } from "@/i18n/navigation";

// /komunita/udalosti/nova → feed create flow with the type preselected (BYT-20261117-002 Phase 5: Komunita merged into Oznamy).
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: { pathname: "/board/novy", query: { typ: "udalost" } }, locale });
}
