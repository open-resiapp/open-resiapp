"use client";

// Bank ↔ ledger reconciliation banner shown after a camt.053 import: the
// statement's booked closing balance (CLBD) vs the 221 Bankové účty
// balance at the statement end date. A mismatch lists the likely causes
// the import itself knows about: outgoing lines (never booked by the
// import — they belong to expense payments) and incoming lines still
// waiting for a flat (not on 221 until confirmed).

import { useFormatter, useTranslations } from "next-intl";
import { formatEur } from "@modules/accounting/src/lib/money";

export interface BankBalanceCheck {
  statementId: string | null;
  iban: string | null;
  asOf: string;
  statementClosingCents: number;
  ledgerCents: number;
  differenceCents: number;
  debits: {
    date: string | null;
    amountCents: number;
    counterpartyName: string | null;
    narrative: string | null;
  }[];
  debitsTotalCents: number;
  pendingCreditsCents: number;
  pendingCreditsCount: number;
}

export default function BankBalanceCheckBanner({ check }: { check: BankBalanceCheck }) {
  const t = useTranslations("Accounting.bankBalance");
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const ok = check.differenceCents === 0;

  return (
    <div
      role={ok ? "status" : "alert"}
      className={`mt-3 rounded-lg border p-4 text-base ${
        ok
          ? "border-ui-success bg-ui-surface text-ui-text"
          : "border-ui-danger bg-ui-surface text-ui-text"
      }`}
    >
      <p className={`font-semibold ${ok ? "text-ui-success" : "text-ui-danger"}`}>
        {ok ? t("match", { date: day(check.asOf) }) : t("mismatch", { date: day(check.asOf) })}
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3">
        <div>
          <dt className="text-ui-text-muted">{t("statement")}</dt>
          <dd className="font-medium">{formatEur(check.statementClosingCents)}</dd>
        </div>
        <div>
          <dt className="text-ui-text-muted">{t("ledger")}</dt>
          <dd className="font-medium">{formatEur(check.ledgerCents)}</dd>
        </div>
        <div>
          <dt className="text-ui-text-muted">{t("difference")}</dt>
          <dd className="font-medium">{formatEur(check.differenceCents)}</dd>
        </div>
      </dl>

      {!ok && (
        <div className="mt-3 space-y-2">
          <p>{t("causesIntro")}</p>
          {check.pendingCreditsCount > 0 && (
            <p>
              {t("pendingCredits", {
                count: check.pendingCreditsCount,
                amount: formatEur(check.pendingCreditsCents),
              })}
            </p>
          )}
          {check.debits.length > 0 ? (
            <>
              <p>
                {t("debitsIntro", {
                  count: check.debits.length,
                  amount: formatEur(check.debitsTotalCents),
                })}
              </p>
              <ul className="divide-y divide-ui-border rounded-lg border border-ui-border">
                {check.debits.map((d, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-3 py-2">
                    <span className="min-w-0 break-words">
                      {d.date ? `${day(d.date)} · ` : ""}
                      {d.counterpartyName ?? t("unknownCounterparty")}
                      {d.narrative ? ` · ${d.narrative}` : ""}
                    </span>
                    <span className="shrink-0 font-medium">−{formatEur(d.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("noDebits")}</p>
          )}
          <p className="text-ui-text-muted">{t("otherCauses")}</p>
        </div>
      )}
    </div>
  );
}
