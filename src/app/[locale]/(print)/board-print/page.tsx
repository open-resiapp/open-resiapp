import { getFormatter, getTranslations } from "next-intl/server";

import PrintButton from "@/components/nastenka/PrintButton";
import { ButtonLink } from "@/components/ui";
import { auth } from "@/lib/auth";
import { listPostsForPrint } from "@/lib/posts";
import { viewerFromSession } from "@/lib/mcp/principal";
import { redirect } from "@/i18n/navigation";

// Printable notice board ("Nástenka") for the physical house board: last N
// notices, large type, A4. Outside the dashboard chrome so nothing but the
// notices reaches the paper. Visibility = same rule as the feed.

const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;

export default async function BoardPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ n?: string | string[] }>;
}) {
  const [{ locale }, sp, session, t, format] = await Promise.all([
    params,
    searchParams,
    auth(),
    getTranslations("BoardPrint"),
    getFormatter(),
  ]);
  if (!session?.user?.id) {
    redirect({ href: "/login", locale });
    return null;
  }
  const rawN = Number(Array.isArray(sp.n) ? sp.n[0] : sp.n);
  const count = Number.isInteger(rawN) && rawN > 0 ? Math.min(rawN, MAX_COUNT) : DEFAULT_COUNT;
  const rows = await listPostsForPrint(viewerFromSession(session), count);

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-8 text-black print:p-0">
      <style>{`@page { size: A4; margin: 15mm; }`}</style>
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton />
        <ButtonLink variant="secondary" href="/board">
          {t("back")}
        </ButtonLink>
        <span className="text-base text-gray-700">{t("hint", { count: rows.length })}</span>
      </div>

      <h1 className="mb-6 text-4xl font-bold">{t("title")}</h1>

      {rows.length === 0 ? (
        <p className="text-xl">{t("empty")}</p>
      ) : (
        <ol className="space-y-8">
          {rows.map((p) => (
            <li key={p.id} className="break-inside-avoid border-b-2 border-gray-400 pb-6">
              <h2 className="text-3xl font-bold">{p.title}</h2>
              <p className="mt-1 text-xl text-gray-700">
                {format.dateTime(p.createdAt, { dateStyle: "long" })}
                {p.entranceName ? ` · ${p.entranceName}` : ""}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-2xl leading-relaxed">{p.content}</p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
