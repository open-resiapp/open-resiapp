import { notFound } from "next/navigation";

import { redirect } from "@/i18n/navigation";
import { getViewer, isViewerGated } from "@/lib/home.server";
import { findChapterForAnchor } from "@/lib/laws-reader";
import { getLaw } from "@/lib/laws.server";

// Stable deep link to a provision / paragraph / item:
//   /zakony/<id>/p/<anchor>  →  /zakony/<id>?kapitola=<n>#<anchor>
// Copy-link buttons and (later) MCP citations use this form, so links keep
// working if chapter boundaries change. Unknown anchors open chapter 1.

export default async function LawAnchorResolver({
  params,
}: {
  params: Promise<{ locale: string; id: string; anchor: string }>;
}) {
  const [{ locale, id, anchor: rawAnchor }, viewer] = await Promise.all([params, getViewer()]);
  if (!viewer || isViewerGated(viewer)) return null;

  const law = await getLaw(id);
  if (!law) notFound();

  const anchor = decodeURIComponent(rawAnchor);
  const chapter = findChapterForAnchor(law, anchor);
  redirect({
    href: chapter ? `/zakony/${law.id}?kapitola=${chapter}#${encodeURIComponent(anchor)}` : `/zakony/${law.id}`,
    locale,
  });
}
