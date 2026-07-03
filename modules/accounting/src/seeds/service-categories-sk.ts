// SK service-category catalog — FULL enumeration (BYT-20260512-002).
//
// Project rule: a feature seeding a reference table lands the complete
// catalog BEFORE any bootstrap path reads it. This is the complete SK set
// from the spec; MGMT_CZ is CZ-only and ships with the Phase 6 CZ catalog.
//
// Display names live in messages/{sk,en,cs}.json under
// Accounting.serviceCategories.{slug} — nameKey column stores the slug,
// never display text.
//
// DB rows are inserted by migration drizzle/0050_accounting_sk_catalog.sql
// — keep in sync: any change here requires a new migration.

import type { okruhEnum } from "../db/schema";

export type Okruh = (typeof okruhEnum.enumValues)[number];

export interface ServiceCategorySeed {
  slug: string;
  okruh: Okruh;
  sortOrder: number;
}

// Typed handles for the allocation/posting engine.
export const SERVICE_CATEGORY_SLUGS = {
  FPUO: "FPUO",
  SVC_HEAT: "SVC_HEAT",
  SVC_WATER_COLD: "SVC_WATER_COLD",
  SVC_WATER_HOT: "SVC_WATER_HOT",
  SVC_ELECTRICITY_COMMON: "SVC_ELECTRICITY_COMMON",
  SVC_LIFT: "SVC_LIFT",
  SVC_CLEANING: "SVC_CLEANING",
  SVC_INTERNET: "SVC_INTERNET",
  SVC_OTHER: "SVC_OTHER",
} as const;

export const SERVICE_CATEGORIES_SK: ServiceCategorySeed[] = [
  { slug: SERVICE_CATEGORY_SLUGS.FPUO, okruh: "fpuo", sortOrder: 0 },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_HEAT, okruh: "svc", sortOrder: 10 },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_WATER_COLD, okruh: "svc", sortOrder: 20 },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_WATER_HOT, okruh: "svc", sortOrder: 30 },
  {
    slug: SERVICE_CATEGORY_SLUGS.SVC_ELECTRICITY_COMMON,
    okruh: "svc",
    sortOrder: 40,
  },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_LIFT, okruh: "svc", sortOrder: 50 },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_CLEANING, okruh: "svc", sortOrder: 60 },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_INTERNET, okruh: "svc", sortOrder: 70 },
  { slug: SERVICE_CATEGORY_SLUGS.SVC_OTHER, okruh: "svc", sortOrder: 99 },
];
