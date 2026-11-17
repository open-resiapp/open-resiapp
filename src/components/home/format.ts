import type { createFormatter } from "next-intl";

// Shared money/date formatting for the Phase 4 owner screens (Domov,
// Moje platby, Dom). Uses next-intl's locale formatter (server:
// getFormatter(), client: useFormatter()) so sk/cs/en render natively.

export type Formatter = ReturnType<typeof createFormatter>;

/** Domain timezone — dates are shown as the building experiences them. */
export const DOMAIN_TIME_ZONE = "Europe/Bratislava";

/** "1 148 €" for whole euros, "1 148,50 €" otherwise. */
export function formatMoney(format: Formatter, cents: number): string {
  const whole = cents % 100 === 0;
  return format.number(cents / 100, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** "15. 12." (sk) — day and month only. */
export function formatDayMonth(format: Formatter, iso: string): string {
  return format.dateTime(new Date(iso), {
    day: "numeric",
    month: "numeric",
    timeZone: DOMAIN_TIME_ZONE,
  });
}

/** "15. 12. 2026" (sk). */
export function formatDate(format: Formatter, iso: string): string {
  return format.dateTime(new Date(iso), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: DOMAIN_TIME_ZONE,
  });
}
