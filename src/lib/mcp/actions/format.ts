import "server-only";

import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { formatEur } from "@modules/accounting/src/lib/money";
import { APP_LOCALES, type ActionContext, type AppLocale, type Translator } from "./types";

// Locale + formatting helpers for pending-action previews and results.

export function isAppLocale(s: unknown): s is AppLocale {
  return typeof s === "string" && (APP_LOCALES as readonly string[]).includes(s);
}

/**
 * Locale for a proposal: the tool's explicit `locale` argument, else the
 * community's language (CZ → cs), else the instance default.
 */
export function resolveActionLocale(
  requested: unknown,
  root: { country: string } | null | undefined
): AppLocale {
  if (isAppLocale(requested)) return requested;
  if (root?.country === "cz") return "cs";
  const def = routing.defaultLocale;
  return isAppLocale(def) ? def : "sk";
}

/** Root translator for a locale (keys are full paths, e.g. "Mcp.actions.…"). */
export async function translatorFor(locale: AppLocale): Promise<Translator> {
  const t = await getTranslations({ locale });
  return (key, values) => t(key as never, values as never);
}

/** Does the catalog of `locale` have `key`? (Optional keys owned by other features.) */
export async function hasMessage(locale: AppLocale, key: string): Promise<boolean> {
  const t = await getTranslations({ locale });
  return t.has(key as never);
}

const BCP47: Record<AppLocale, string> = { sk: "sk-SK", en: "en-GB", cs: "cs-CZ" };

export function fmtMoney(cents: number, locale: AppLocale): string {
  return formatEur(cents, BCP47[locale]);
}

export function fmtDate(d: Date | string, locale: AppLocale): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString(BCP47[locale], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Europe/Bratislava",
  });
}

export function fmtDateTime(d: Date | string, locale: AppLocale): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString(BCP47[locale], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bratislava",
  });
}

/** Meter value stored in thousandths → "12,345". */
export function fmtMilli(valueMilli: number, locale: AppLocale): string {
  return (valueMilli / 1000).toLocaleString(BCP47[locale], {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/** Localised absolute deep link into the app: `<origin>/<locale><path>`. */
export function appLink(ctx: Pick<ActionContext, "origin">, locale: AppLocale, path: string): string {
  return `${ctx.origin}/${locale}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Audit justification stamped on accounting audit rows for AI-proposed writes. */
export function mcpJustification(ctx: Pick<ActionContext, "clientName">): string {
  return `MCP: ${ctx.clientName}`.slice(0, 255);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Is the input a bare calendar date (YYYY-MM-DD, no time)? */
export function isDateOnly(raw: string): boolean {
  return DATE_ONLY_RE.test(raw.trim());
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * A bare date (YYYY-MM-DD) at a wall-clock time in `timeZone` → the UTC
 * instant. DST-safe: the offset is re-read at the candidate instant.
 * Null when `raw` is not a valid bare date.
 */
export function zonedDateTimeToUtc(
  raw: string,
  time: { h: number; m: number; s: number },
  timeZone: string
): Date | null {
  const m = DATE_ONLY_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wall = Date.UTC(y, mo - 1, d, time.h, time.m, time.s);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  let utc = wall - zoneOffsetMs(wall, timeZone);
  const corrected = wall - zoneOffsetMs(utc, timeZone);
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}
