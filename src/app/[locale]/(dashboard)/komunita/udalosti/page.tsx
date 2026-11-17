import { redirect } from "@/i18n/navigation";

// /komunita/udalosti → merged feed (BYT-20261117-002 Phase 5: Komunita merged into Oznamy).
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: { pathname: "/board", query: { typ: "udalosti" } }, locale });
}
