import { getFormatter, getTranslations } from "next-intl/server";

import { ButtonLink, Card, Icon } from "@/components/ui";
import type { UnitBalanceLine } from "@modules/accounting/src/lib/owner-payments";

import { formatMoney, type Formatter } from "./format";

// Owner balance on Domov: owe / all paid / overpaid, one line per unit when
// the owner has several. Numbers come from listUnitBalances (karta list).

type Translator = (key: string, values?: Record<string, string | number>) => string;

function statusText(t: Translator, format: Formatter, cents: number): string {
  if (cents > 0) return t("owe", { amount: formatMoney(format, cents) });
  if (cents < 0) return t("overpaid", { amount: formatMoney(format, -cents) });
  return t("paid");
}

export async function BalanceCard({
  lines,
  primary,
}: {
  lines: UnitBalanceLine[];
  /** Whether "Ako zaplatiť" is the screen's primary button. */
  primary: boolean;
}) {
  const t = await getTranslations("Home.balance");
  const format = await getFormatter();
  const owes = lines.some((l) => l.balanceCents > 0);

  return (
    <Card as="section" padding="lg" className="space-y-3">
      <p className="flex items-center gap-2 text-base font-medium text-ui-text-muted">
        <Icon name="wallet" size={20} />
        {t("label")}
      </p>
      {lines.length === 1 ? (
        <p
          className={
            lines[0].balanceCents > 0
              ? "text-2xl font-bold text-ui-danger"
              : "text-2xl font-bold text-ui-text"
          }
        >
          {statusText(t, format, lines[0].balanceCents)}
        </p>
      ) : (
        <ul className="space-y-1">
          {lines.map((l) => (
            <li
              key={l.unitEntityId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 text-lg"
            >
              <span className="text-ui-text-muted">{t("unit", { unit: l.label })}</span>
              <span
                className={
                  l.balanceCents > 0 ? "font-bold text-ui-danger" : "font-bold text-ui-text"
                }
              >
                {statusText(t, format, l.balanceCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink
        href="/moje-platby"
        variant={primary ? "primary" : "secondary"}
        fullWidth={owes}
      >
        {t("howToPay")}
      </ButtonLink>
    </Card>
  );
}
