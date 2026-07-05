import "server-only";

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { supplierLookupCache } from "../db/schema";
import {
  aresSubjectUrl,
  finstatDetailUrl,
  mapAresSubject,
  mapFinstatDetail,
  normalizeIco,
  type AresSubjectJson,
  type FinstatDetailJson,
  type SupplierInfo,
} from "./supplier-lookup-format";

// Supplier IČO lookup connector (spec §Supplier / IČO validation).
// SK → FinStat (requires FINSTAT_API_KEY env; without it the lookup
// reports "not configured" instead of failing the expense form),
// CZ → ARES (free). Results cache 24h per (country, ico); the HTTP
// layer is injectable — tests never hit the network.

type Country = "sk" | "cz";

const CACHE_TTL_MS = 24 * 3600 * 1000;

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * FinStat request hash — per their docs SHA-256 over
 * "SomeSalt+apiKey+privateKey+ico". VERIFY the exact salt/recipe with a
 * real account (spec open question); this is the single adjustment point.
 */
function finstatRequestHash(
  apiKey: string,
  privateKey: string,
  ico: string
): string {
  return createHash("sha256")
    .update(`SomeSalt+${apiKey}+${privateKey}+${ico}`)
    .digest("hex");
}

export type LookupOutcome =
  | { status: "ok"; info: SupplierInfo; cached: boolean }
  | { status: "not_configured" }
  | { status: "invalid_ico" }
  | { status: "provider_error"; httpStatus: number };

export async function lookupSupplier(input: {
  country: Country;
  ico: string;
  fetchImpl?: FetchLike;
  /** Bypass the cache (refresh-on-demand button). */
  force?: boolean;
  now?: Date;
}): Promise<LookupOutcome> {
  const ico = normalizeIco(input.ico);
  if (!ico) return { status: "invalid_ico" };
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = input.now ?? new Date();

  if (!input.force) {
    const [cached] = await db
      .select({
        payload: supplierLookupCache.payload,
        fetchedAt: supplierLookupCache.fetchedAt,
      })
      .from(supplierLookupCache)
      .where(
        and(
          eq(supplierLookupCache.country, input.country),
          eq(supplierLookupCache.ico, ico)
        )
      );
    if (cached && now.getTime() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return {
        status: "ok",
        info: cached.payload as unknown as SupplierInfo,
        cached: true,
      };
    }
  }

  let url: string;
  if (input.country === "sk") {
    const apiKey = process.env.FINSTAT_API_KEY;
    const privateKey = process.env.FINSTAT_PRIVATE_KEY;
    if (!apiKey || !privateKey) return { status: "not_configured" };
    url = finstatDetailUrl(ico, apiKey, finstatRequestHash(apiKey, privateKey, ico));
  } else {
    url = aresSubjectUrl(ico);
  }

  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    return { status: "provider_error", httpStatus: 0 };
  }
  // ARES answers 404 for unknown IČO — that is a definitive "not found",
  // not a provider failure.
  if (!response.ok && response.status !== 404) {
    return { status: "provider_error", httpStatus: response.status };
  }

  let info: SupplierInfo;
  if (response.status === 404) {
    info =
      input.country === "sk"
        ? mapFinstatDetail(ico, null)
        : mapAresSubject(ico, null);
  } else {
    let payload: FinstatDetailJson | AresSubjectJson;
    try {
      payload = (await response.json()) as FinstatDetailJson | AresSubjectJson;
    } catch {
      // 200 with a non-JSON body (gateway/maintenance page).
      return { status: "provider_error", httpStatus: response.status };
    }
    info =
      input.country === "sk"
        ? mapFinstatDetail(ico, payload as FinstatDetailJson)
        : mapAresSubject(ico, payload as AresSubjectJson);
  }

  // Only HITS cache — a transient miss (provider hiccup, freshly
  // registered company) must not be pinned for 24 hours.
  if (info.found) {
    await db
      .insert(supplierLookupCache)
      .values({
        country: input.country,
        ico,
        payload: info as unknown as Record<string, unknown>,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [supplierLookupCache.country, supplierLookupCache.ico],
        set: {
          payload: info as unknown as Record<string, unknown>,
          fetchedAt: sql`now()`,
        },
      });
  }

  return { status: "ok", info, cached: false };
}
