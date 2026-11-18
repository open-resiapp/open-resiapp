import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { checkRateLimitKey, RATE_LIMITS } from "@/lib/rate-limiter";
import {
  describeBallot,
  isPendingBallotToken,
  lookupPendingBallot,
  shortBallotHash,
} from "@modules/voting/src/pending-ballots";
import { decidePendingBallot } from "./actions";

// Ballot confirmation from the email link (BYT-20261117-001 §6 step 3) —
// shared by web and MCP ballots (BYT-20261118-009; gated by the voting
// module, an MCP-originated request additionally by the MCP module).
// Requires a session of the SAME owner the ballot was requested for
// (Decided 3); shows the full ballot (every item + choice + short hash, the
// same as the email) and casts it only on an explicit "I confirm my vote"
// click. Cancel is an equally explicit button. Expired / used / superseded /
// another owner's link each get their own state; no resend exists.
// Legally regulated copy — legal sign-off pending (spec AC).

export const dynamic = "force-dynamic";

const CARD = "bg-white rounded-2xl shadow-sm p-6 dark:bg-gray-800 dark:shadow-black/40";

const ERROR_KEYS = new Set([
  "action_expired",
  "forbidden",
  "voting_not_active",
  "electronic_blocked",
  "not_unit_owner",
  "unit_out_of_scope",
  "conflict_state_changed",
  "rate_limited",
  "internal",
  "email_failed",
]);

function errorKey(code: string): string {
  const k = code.replace(".", "_");
  return ERROR_KEYS.has(k) ? k : "generic";
}

function StateCard({ title, message, tone }: { title: string; message: string; tone: "ok" | "err" | "muted" }) {
  const color =
    tone === "ok"
      ? "text-green-700 dark:text-green-400"
      : tone === "err"
        ? "text-red-700 dark:text-red-400"
        : "text-gray-700 dark:text-gray-300";
  return (
    <div className="max-w-2xl mx-auto">
      <div className={CARD}>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        <p className={`mt-3 text-base font-semibold ${color}`}>{message}</p>
      </div>
    </div>
  );
}

export default async function VotingConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isModuleEnabled("voting"))) notFound();
  const { locale, token } = await params;
  const sp = await searchParams;
  const errorCode = typeof sp.e === "string" ? sp.e : null;
  const passkeyActivated = sp.pk === "1";

  const t = await getTranslations("VotingConfirm");
  if (!isPendingBallotToken(token)) {
    return <StateCard title={t("title")} message={t("invalid")} tone="err" />;
  }

  const pagePath = `/${locale}/voting/confirm/${token}`;
  const session = await auth();
  if (!session) redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(pagePath)}`);

  if (
    !errorCode &&
    checkRateLimitKey(`u:${session.user.id}`, RATE_LIMITS.ballotConfirm, "ballotConfirm") !== null
  ) {
    return <StateCard title={t("title")} message={t("errors.rate_limited")} tone="err" />;
  }

  const found = await lookupPendingBallot(token, session.user.id);
  if (found.kind === "missing") {
    return <StateCard title={t("title")} message={t("invalid")} tone="err" />;
  }
  if (found.kind === "other_owner") {
    // No ballot content for anyone but its owner.
    return <StateCard title={t("title")} message={t("otherOwner")} tone="err" />;
  }

  const row = found.row;
  if (row.source === "mcp" && !(await isMcpEnabled())) {
    return <StateCard title={t("title")} message={t("invalid")} tone="err" />;
  }
  const desc = await describeBallot(row.votingId, row.unitId, row.items);
  if (!desc) {
    return <StateCard title={t("title")} message={t("errors.voting_not_active")} tone="err" />;
  }
  const format = await getFormatter();
  const fmt = (d: Date) =>
    format.dateTime(d, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Bratislava" });
  const choiceLabel = (c: string | null) =>
    c === "za"
      ? t("choice_za")
      : c === "proti"
        ? t("choice_proti")
        : c === "zdrzal_sa"
          ? t("choice_zdrzal_sa")
          : t("choice_unmarked");

  let statusBlock: React.ReactNode = null;
  if (row.status === "confirmed") {
    statusBlock = (
      <p className="text-base font-semibold text-green-700 dark:text-green-400">
        {t("confirmed")}{" "}
        {passkeyActivated && <>{t("passkeyActivated")} </>}
        <a href={`/${locale}/voting/${row.votingId}`} className="underline">
          {t("openVoting")}
        </a>
      </p>
    );
  } else if (row.status === "cancelled") {
    statusBlock = <p className="text-base font-semibold text-gray-700 dark:text-gray-300">{t("cancelled")}</p>;
  } else if (row.status === "superseded") {
    statusBlock = <p className="text-base font-semibold text-red-700 dark:text-red-400">{t("superseded")}</p>;
  } else if (row.status === "expired") {
    statusBlock = <p className="text-base font-semibold text-red-700 dark:text-red-400">{t("expired")}</p>;
  } else if (row.status === "failed") {
    statusBlock = (
      <p className="text-base font-semibold text-red-700 dark:text-red-400">
        {t(`errors.${errorKey(row.failureCode ?? "generic")}`)}
      </p>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className={CARD}>
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("title")}</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">{desc.votingTitle}</h1>
        {row.status === "pending" && (
          <>
            <p className="mt-3 text-base text-gray-700 dark:text-gray-300">
              {t(row.source === "web" ? "introWeb" : "intro")}
            </p>
            <p className="mt-2 text-base font-semibold text-gray-900 dark:text-gray-100">{t("notCastYet")}</p>
          </>
        )}

        <dl className="mt-4 divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-3">
            <dt className="text-base text-gray-500 dark:text-gray-400">{t("unitLabel")}</dt>
            <dd className="text-base text-gray-900 dark:text-gray-100 sm:col-span-2 break-words">{desc.unitName}</dd>
          </div>
          <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-3">
            <dt className="text-base text-gray-500 dark:text-gray-400">{t("endsLabel")}</dt>
            <dd className="text-base text-gray-900 dark:text-gray-100 sm:col-span-2">{fmt(desc.votingEndsAt)}</dd>
          </div>
        </dl>

        {/* Choices are kept only while the request is pending (retention:
            pending-ballots.ts empties `items` once it is decided). */}
        {row.status === "pending" && (
        <>
          <h2 className="mt-5 text-lg font-semibold text-gray-900 dark:text-gray-100">{t("itemsHeading")}</h2>
          <ol className="mt-2 divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {desc.items.map((it, i) => (
              <li key={it.itemId} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <span className="text-base text-gray-900 dark:text-gray-100 break-words">
                  <span className="text-gray-500 dark:text-gray-400">{i + 1}.</span> {it.title}
                </span>
                <span
                  className={[
                    "text-base font-bold whitespace-nowrap",
                    it.choice ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400",
                  ].join(" ")}
                >
                  {choiceLabel(it.choice)}
                </span>
              </li>
            ))}
          </ol>
        </>
        )}

        <p className="mt-4 text-base text-gray-700 dark:text-gray-300">
          {t("hashLabel")}{" "}
          <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-base text-gray-900 dark:bg-gray-900 dark:text-gray-100">
            {shortBallotHash(row.ballotHash)}
          </code>
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("hashHint")}</p>

        {errorCode && row.status === "pending" && (
          <p role="alert" className="mt-4 text-base font-semibold text-red-700 dark:text-red-400">
            {t(`errors.${errorKey(errorCode)}`)}
          </p>
        )}

        <div className="mt-6" aria-live="polite">
          {row.status === "pending" ? (
            <form action={decidePendingBallot} className="flex flex-col gap-3 sm:flex-row">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                name="decision"
                value="confirm"
                className="flex-1 rounded-lg bg-blue-600 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700"
              >
                {t("confirmButton")}
              </button>
              <button
                type="submit"
                name="decision"
                value="cancel"
                className="flex-1 rounded-lg border border-gray-300 bg-white px-5 py-3 text-base font-semibold text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                {t("cancelButton")}
              </button>
            </form>
          ) : (
            statusBlock
          )}
        </div>
        {row.status === "pending" && (
          <>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t("expiresAt", { time: fmt(row.expiresAt) })}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t("changeHint")}{" "}
              <a href={`/${locale}/voting/${row.votingId}`} className="underline">
                {t("openVoting")}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
