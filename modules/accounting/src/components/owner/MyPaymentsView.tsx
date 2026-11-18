import { getFormatter, getTranslations } from "next-intl/server";

import { Card, Icon, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";
import { formatDate, formatMoney } from "@/components/home/format";
import DownloadPredpisButton from "@modules/accounting/src/components/DownloadPredpisButton";
import DownloadVyuctovanieButton from "@modules/accounting/src/components/DownloadVyuctovanieButton";
import type { OwnerPaymentSummary } from "@modules/accounting/src/lib/owner-payments";
import type { OwnerReadingsView } from "@modules/accounting/src/lib/reading-rounds-format";

import { PaymentQr } from "./PaymentQr";
import { ReadingsSection } from "./ReadingsSection";

// "Moje platby" body for one unit (BYT-20261117-002 Phase 4). Pure
// rendering of OwnerPaymentSummary — every number comes from the karta
// lib functions behind it. Server component; the two PDF downloads are the
// existing client buttons the unit card uses.

const textLink = cn(
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-base font-medium text-ui-text underline underline-offset-4",
  focusRing
);

/** "SK12 3456 …" — IBAN in groups of four for reading aloud / retyping. */
function groupIban(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

export async function MyPaymentsView({
  summary,
  country,
  readings,
}: {
  summary: OwnerPaymentSummary;
  country: "sk" | "cz";
  /** Reading round view (BYT-20261118-006); null when not loaded. */
  readings?: OwnerReadingsView | null;
}) {
  const t = await getTranslations("MyPayments");
  const format = await getFormatter();
  const money = (cents: number) => formatMoney(format, cents);
  const lastYear = new Date().getUTCFullYear() - 1;
  const s = summary;

  const status =
    s.balanceCents > 0
      ? t("statusOwe", { amount: money(s.balanceCents) })
      : s.balanceCents < 0
        ? t("statusOverpaid", { amount: money(-s.balanceCents) })
        : t("statusPaid");

  const settlement = s.latestSettlement;
  const settlementCurrent = settlement && settlement.year >= lastYear ? settlement : null;

  return (
    <div className="space-y-6">
      {/* Status sentence */}
      <Card as="section" padding="lg" className="space-y-2">
        <p
          className={cn(
            "text-3xl font-bold break-words",
            s.balanceCents > 0 ? "text-ui-danger" : "text-ui-text"
          )}
        >
          {status}
        </p>
        {s.overdue.months > 0 ? (
          <p className="text-base text-ui-text-muted">
            {t("overdueSentence", {
              amount: money(s.overdue.totalOpenCents),
              months: s.overdue.months,
            })}
            {s.overdue.creditAppliedCents > 0
              ? ` ${t("overdueCreditNote", { amount: money(s.overdue.creditAppliedCents) })}`
              : null}
          </p>
        ) : null}
      </Card>

      {/* Monthly payment: amount, IBAN, VS, QR, predpis PDF */}
      <Card as="section" padding="lg" className="space-y-4">
        {s.monthly ? (
          <>
            <h2 className="text-xl font-semibold text-ui-text">
              {t("monthly", { amount: money(s.monthly.totalCents) })}
            </h2>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {s.monthly.qrPayload ? (
                <div className="flex flex-col items-center gap-2 sm:items-start">
                  <PaymentQr payload={s.monthly.qrPayload} alt={t("qrAlt")} />
                  <p className="max-w-[220px] text-base text-ui-text-muted">
                    {country === "cz" ? t("qrHintCz") : t("qrHint")}
                  </p>
                </div>
              ) : null}
              <dl className="min-w-0 flex-1 space-y-3">
                <div>
                  <dt className="text-base text-ui-text-muted">{t("iban")}</dt>
                  <dd className="text-lg font-semibold text-ui-text break-all">
                    {groupIban(s.monthly.iban)}
                  </dd>
                </div>
                <div>
                  <dt className="text-base text-ui-text-muted">{t("vs")}</dt>
                  <dd className="text-lg font-semibold text-ui-text">{s.monthly.vs}</dd>
                </div>
              </dl>
            </div>
            <DownloadPredpisButton unitId={s.unitEntityId} />
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-ui-text">{t("monthlyHeading")}</h2>
            <p className="text-base text-ui-text-muted">{t("monthlyNotReady")}</p>
            {s.vs ? (
              <p className="text-base text-ui-text">
                {t("vs")}: <span className="font-semibold">{s.vs}</span>
              </p>
            ) : null}
          </>
        )}
      </Card>

      {/* Last payments */}
      <Card as="section" padding="lg" className="space-y-3">
        <h2 className="text-xl font-semibold text-ui-text">{t("paymentsHeading")}</h2>
        {s.lastPayments.length === 0 ? (
          <p className="text-base text-ui-text-muted">{t("noPayments")}</p>
        ) : (
          <ul className="divide-y divide-ui-border">
            {s.lastPayments.map((p) => (
              <li
                key={p.journalEntryId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 py-2"
              >
                <span className="flex items-center gap-2 text-base text-ui-text">
                  <Icon name="check" size={20} className="text-ui-success" />
                  {t("paymentReceived", { date: formatDate(format, p.postedAt) })}
                </span>
                <span className="text-lg font-semibold text-ui-text">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/accounting/karta/${s.unitEntityId}`} className={textLink}>
          {t("history")}
          <Icon name="chevronRight" size={20} />
        </Link>
      </Card>

      {/* Yearly settlement */}
      <Card as="section" padding="lg" className="space-y-3">
        <h2 className="text-xl font-semibold text-ui-text">{t("settlementHeading")}</h2>
        {settlementCurrent ? (
          <>
            <p className="text-lg text-ui-text">
              {settlementCurrent.differenceCents === null
                ? t("settlementPublished", { year: settlementCurrent.year })
                : settlementCurrent.differenceCents > 0
                  ? t("settlementDoplatok", {
                      year: settlementCurrent.year,
                      amount: money(settlementCurrent.differenceCents),
                    })
                  : settlementCurrent.differenceCents < 0
                    ? t("settlementPreplatok", {
                        year: settlementCurrent.year,
                        amount: money(-settlementCurrent.differenceCents),
                      })
                    : t("settlementZero", { year: settlementCurrent.year })}
            </p>
            {country === "sk" ? (
              <DownloadVyuctovanieButton unitId={s.unitEntityId} year={settlementCurrent.year} />
            ) : null}
          </>
        ) : (
          <p className="text-base text-ui-text-muted">
            {t("settlementNotReady", { year: lastYear })}
          </p>
        )}
      </Card>

      {/* Odpočty a osoby (BYT-20261118-006) — inputs only while a reading
          round is open; otherwise a one-line last-submission summary. */}
      {readings ? <ReadingsSection view={readings} unitEntityId={s.unitEntityId} /> : null}

      <p>
        <Link href="/accounting/inspect" className={textLink}>
          {t("howHouseManages")}
          <Icon name="chevronRight" size={20} />
        </Link>
      </p>
    </div>
  );
}
