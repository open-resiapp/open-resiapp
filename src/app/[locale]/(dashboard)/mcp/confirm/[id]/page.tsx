import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { decisionErrorKey } from "@/lib/mcp/actions/present";
import { lookupPendingActionForUser } from "@/lib/mcp/actions/service";
import type { ActionPreview } from "@/lib/mcp/actions/types";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import { decidePendingAction } from "./actions";

// In-app fallback for confirming an AI-proposed change (BYT-20261117-001 §5
// step 5): hosts without MCP Apps link here. Requires the NextAuth session
// of the user who owns the pending action; shows the same preview and the
// same explicit Confirm / Cancel buttons as the MCP App view.

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CARD = "bg-white rounded-2xl shadow-sm p-6 dark:bg-gray-800 dark:shadow-black/40";

export default async function McpConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isMcpEnabled())) notFound();
  const { locale, id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const errorCode = typeof sp.e === "string" ? sp.e : null;

  const session = await auth();
  if (!session) {
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/mcp/confirm/${id}`)}`);
  }

  const t = await getTranslations("Mcp.confirmPage");
  const tv = await getTranslations("Mcp.view");
  const te = await getTranslations("Mcp.errors");
  const format = await getFormatter();

  const found = await lookupPendingActionForUser(id, session.user.id);
  if (found.kind === "missing") notFound();
  if (found.kind === "forbidden") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className={CARD}>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h1>
          <p className="mt-3 text-base text-red-700 dark:text-red-400">{te("forbidden")}</p>
          <p className="mt-2 text-base text-gray-600 dark:text-gray-400">{t("otherUser")}</p>
        </div>
      </div>
    );
  }

  const row = found.row;
  const preview = row.preview as unknown as ActionPreview;
  const result = (row.result ?? null) as { path?: string | null } | null;
  const resultPath = typeof result?.path === "string" ? `/${locale}${result.path}` : null;
  const hasUntrusted = preview.rows.some((r) => r.untrusted);

  let statusBlock: React.ReactNode = null;
  if (row.status === "confirmed" && row.resultCode === "ok") {
    statusBlock = (
      <p className="text-base font-semibold text-green-700 dark:text-green-400">
        {preview.doneMessage ?? t("done")}{" "}
        {resultPath && (
          <a href={resultPath} className="underline">
            {tv("openInApp")}
          </a>
        )}
      </p>
    );
  } else if (row.status === "cancelled") {
    statusBlock = <p className="text-base font-semibold text-gray-700 dark:text-gray-300">{tv("cancelledMessage")}</p>;
  } else if (row.status === "expired") {
    statusBlock = <p className="text-base font-semibold text-red-700 dark:text-red-400">{te("action_expired")}</p>;
  } else if (row.status === "failed" || row.status === "confirmed") {
    statusBlock = (
      <p className="text-base font-semibold text-red-700 dark:text-red-400">
        {te(decisionErrorKey(row.resultCode ?? "generic"))}
      </p>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className={CARD}>
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("title")}</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{preview.title}</h1>
        <p className="mt-1 text-base text-gray-600 dark:text-gray-400">{preview.summary}</p>
        <p className="mt-3 text-base text-gray-700 dark:text-gray-300">{t("intro")}</p>

        <dl className="mt-4 divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {preview.rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-3">
              <dt className="text-base text-gray-500 dark:text-gray-400">{r.label}</dt>
              <dd
                className={[
                  "text-base text-gray-900 dark:text-gray-100 sm:col-span-2 break-words",
                  r.multiline ? "whitespace-pre-wrap" : "",
                  r.untrusted ? "border-l-4 border-gray-300 pl-3 dark:border-gray-600" : "",
                ].join(" ")}
              >
                {r.before !== undefined || r.after !== undefined ? (
                  <>
                    <span className="text-gray-500 line-through dark:text-gray-400">{r.before ?? "—"}</span>
                    <span className="px-2 text-gray-500 dark:text-gray-400" aria-hidden="true">→</span>
                    <span className="font-semibold">{r.after ?? "—"}</span>
                  </>
                ) : (
                  (r.value ?? "—")
                )}
              </dd>
            </div>
          ))}
        </dl>

        {preview.consequences.length > 0 && (
          <>
            <h2 className="mt-5 text-lg font-semibold text-gray-900 dark:text-gray-100">{tv("consequences")}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-base text-gray-800 dark:text-gray-200">
              {preview.consequences.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </>
        )}

        {preview.warnings.length > 0 && (
          <div
            role="note"
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100"
          >
            <p className="font-semibold">{tv("warnings")}</p>
            <ul className="mt-1 list-disc pl-6">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {hasUntrusted && <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">{tv("untrusted")}</p>}

        {errorCode && row.status === "pending" && (
          <p role="alert" className="mt-4 text-base font-semibold text-red-700 dark:text-red-400">
            {te(decisionErrorKey(errorCode))}
          </p>
        )}

        <div className="mt-6" aria-live="polite">
          {row.status === "pending" ? (
            <form action={decidePendingAction} className="flex flex-col gap-3 sm:flex-row">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="actionId" value={row.id} />
              <button
                type="submit"
                name="decision"
                value="confirm"
                className="flex-1 rounded-lg bg-blue-600 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700"
              >
                {preview.confirmLabel ?? tv("confirm")}
              </button>
              <button
                type="submit"
                name="decision"
                value="cancel"
                className="flex-1 rounded-lg border border-gray-300 bg-white px-5 py-3 text-base font-semibold text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                {tv("cancel")}
              </button>
            </form>
          ) : (
            statusBlock
          )}
        </div>
        {row.status === "pending" && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {t("expiresAt", {
              time: format.dateTime(row.expiresAt, {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Europe/Bratislava",
              }),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
