import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import type { InputErrorCode } from "./input-validators";

// Maps an input-validator failure (stable code + field) to the localized
// `Accounting.inputErrors` catalog entry for the HTTP routes. The response
// keeps `error` (now localized — the clients show it as is) and adds the
// machine-readable `code` + `field`.

const FIELD_KEYS = new Set([
  "amountCents",
  "amountNettoCents",
  "dphCents",
  "dphRateBp",
  "supplierName",
  "supplierIco",
  "supplierDic",
  "supplierIban",
  "invoiceNo",
  "invoiceDate",
  "okruh",
  "unitEntityId",
  "method",
  "receivedAt",
  "meterType",
  "valueMilli",
  "readingDate",
]);

function isLocale(v: string | undefined | null): v is string {
  return Boolean(v) && (routing.locales as readonly string[]).includes(v as string);
}

/**
 * UI locale of the page that sent the request: the locale prefix of the
 * Referer path, then the NEXT_LOCALE cookie, then the default locale.
 */
export function requestLocale(req: NextRequest): string {
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const seg = new URL(referer).pathname.split("/")[1];
      if (isLocale(seg)) return seg;
    } catch {
      // malformed Referer — ignore
    }
  }
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (isLocale(cookie)) return cookie;
  return routing.defaultLocale;
}

/** 400 response for a failed accounting input validation, localized. */
export async function inputErrorResponse(
  req: NextRequest,
  failure: { field: string; code: InputErrorCode }
): Promise<NextResponse> {
  const t = await getTranslations({
    locale: requestLocale(req),
    namespace: "Accounting.inputErrors",
  });
  const field = FIELD_KEYS.has(failure.field)
    ? t(`fields.${failure.field}` as Parameters<typeof t>[0])
    : failure.field;
  return NextResponse.json(
    {
      error: t(failure.code as Parameters<typeof t>[0], { field }),
      code: failure.code,
      field: failure.field,
    },
    { status: 400 }
  );
}
