// Client-safe. Maps whatever `templateSlug` an install carries to a slug that
// has a `Templates.<slug>.name` entry in messages/*.json, so the UI never
// renders a raw i18n key. Pre-Phase-5 installs persisted legacy kind slugs
// (e.g. "housing_community") instead of a template slug.

const CATALOG_TEMPLATE_SLUGS = new Set<string>([
  "hoa",
  "garden",
  "garage",
  "street",
  "cottage",
  "urbar",
  "apiary",
  "marina",
  "mobile_home_park",
  "storage_units",
  "office_building",
  "coworking",
  "industrial_park",
  "cemetery",
  "sports_club",
  "hunting_association",
  "fishing_cooperative",
  "parents_association",
  "religious_community",
  "custom",
]);

const LEGACY_SLUG_TO_TEMPLATE: Record<string, string> = {
  housing_community: "hoa",
  housing_block: "hoa",
  housing_entrance: "hoa",
  housing_unit: "hoa",
  community: "hoa",
  generic_group: "custom",
};

/**
 * Returns a template slug that exists in the `Templates` i18n namespace, or
 * `null` when the input is empty/unknown (caller should fall back to its
 * generic label, e.g. `appDescription` / `buildingInfo`).
 *
 * Usage: `const s = getDisplayTemplateSlug(templateSlug);
 *         s ? tRoot(`Templates.${s}.name`) : t("appDescription")`
 */
export function getDisplayTemplateSlug(
  slug: string | null | undefined
): string | null {
  if (!slug) return null;
  if (CATALOG_TEMPLATE_SLUGS.has(slug)) return slug;
  return LEGACY_SLUG_TO_TEMPLATE[slug] ?? null;
}
