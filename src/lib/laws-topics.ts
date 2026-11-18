// Topic → provisions map for `find_legal_basis` (MCP). Hand-written from
// the synced texts in data/laws/** — every anchor below exists in the data
// as of the sync of 2026-11; the search ignores anchors that disappear in a
// later sync (see `laws-search.ts`), so a stale entry degrades to "no
// boost", never to an error. Pure module, client-safe.
//
// `anchors` are PROVISION anchors (p14a = § 14a, whole provision with all
// its paragraphs); omitted = the whole act is on topic.

import type { LawJurisdiction } from "./laws";

export const LAW_TOPICS = [
  "voting",
  "meeting",
  "fund",
  "budget_accounting",
  "heating_billing",
  "renovation_building",
  "administrator",
  "gdpr",
  "ownership_general",
] as const;
export type LawTopic = (typeof LAW_TOPICS)[number];

export interface TopicSource {
  lawId: string;
  anchors?: readonly string[];
}

/** p<from>…p<to> without letter suffixes (§ 1206 – § 1214), minus repealed ones. */
function range(from: number, to: number, repealed: readonly number[] = []): string[] {
  const out: string[] = [];
  for (let n = from; n <= to; n++) if (!repealed.includes(n)) out.push(`p${n}`);
  return out;
}

const SK_HOA = "sk-182-1993";
const CZ_OZ = "cz-89-2012";

export const TOPIC_SOURCES: Record<LawTopic, Record<LawJurisdiction, readonly TopicSource[]>> = {
  voting: {
    // § 14 voting rights + proxies, § 14a meetings / written + electronic
    // voting / minutes, § 14b majorities.
    sk: [{ lawId: SK_HOA, anchors: ["p14", "p14a", "p14b"] }],
    // § 1206 quorum + majority, § 1208 powers, § 1209 outvoted owner,
    // § 1210 substitute meeting, § 1211–1214 decisions outside a meeting.
    cz: [{ lawId: CZ_OZ, anchors: [...range(1206, 1214), "p1191"] }],
  },
  meeting: {
    sk: [{ lawId: SK_HOA, anchors: ["p14a", "p14", "p7c"] }],
    cz: [{ lawId: CZ_OZ, anchors: ["p1207", "p1206", "p1205", "p1210", "p1191"] }],
  },
  fund: {
    // § 10 repair fund, § 14b ods. 1 písm. i) contributions, § 8a / § 7b reporting.
    sk: [{ lawId: SK_HOA, anchors: ["p10", "p14b", "p8a", "p7b"] }],
    cz: [
      { lawId: CZ_OZ, anchors: ["p1180", "p1181", "p1208"] },
      { lawId: "cz-366-2013", anchors: ["p17"] },
    ],
  },
  budget_accounting: {
    sk: [{ lawId: SK_HOA, anchors: ["p7b", "p8a", "p10"] }, { lawId: "sk-431-2002" }],
    cz: [{ lawId: CZ_OZ, anchors: ["p1208"] }, { lawId: "cz-563-1991" }],
  },
  heating_billing: {
    sk: [
      { lawId: SK_HOA, anchors: ["p8a", "p7b", "p10"] },
      { lawId: "sk-657-2004", anchors: ["p14", "p15", "p16", "p17", "p18", "p19"] },
    ],
    cz: [
      { lawId: "cz-67-2013" },
      { lawId: "cz-269-2015" },
      { lawId: CZ_OZ, anchors: ["p1181", "p1208"] },
    ],
  },
  renovation_building: {
    sk: [
      { lawId: SK_HOA, anchors: ["p14b", "p10", "p11", "p13"] },
      { lawId: "sk-150-2013" },
      { lawId: "sk-555-2005" },
      { lawId: "sk-25-2025" },
    ],
    cz: [
      { lawId: CZ_OZ, anchors: ["p1208", "p1175", "p1182", "p1183"] },
      { lawId: "cz-366-2013", anchors: ["p7", "p14"] },
    ],
  },
  administrator: {
    sk: [
      { lawId: SK_HOA, anchors: ["p6", "p8", "p8a", "p8b", "p7", "p7a", "p7b", "p7c", "p7d"] },
      { lawId: "sk-246-2015" },
    ],
    cz: [
      { lawId: CZ_OZ, anchors: range(1189, 1205, [1202, 1203]) },
      { lawId: "cz-366-2013", anchors: range(7, 17) },
    ],
  },
  gdpr: {
    sk: [{ lawId: "sk-18-2018" }],
    // No Czech data-protection act in the library yet.
    cz: [],
  },
  ownership_general: {
    sk: [
      { lawId: SK_HOA, anchors: ["p1", "p2", "p3", "p4", "p5", "p11", "p12", "p13", "p15"] },
      { lawId: "sk-40-1964", anchors: range(123, 142, [138]) },
    ],
    cz: [
      { lawId: CZ_OZ, anchors: range(1158, 1188) },
      { lawId: "cz-366-2013", anchors: range(1, 6) },
    ],
  },
};

/**
 * Keyword stems (folded: lowercase, no diacritics; regex fragments) that
 * imply a topic when the caller passes none. Matched at word start.
 */
export const TOPIC_KEYWORDS: Record<LawTopic, readonly string[]> = {
  voting: ["hlas", "kvor", "vacsin", "vetsin", "rozhodnut", "rollam", "prehlas"],
  meeting: ["schodz", "zhromazd", "shromazd", "zvola", "svola", "pozvank", "zapisnic"],
  fund: ["fond", "preddav", "zaloh", "prispev", "dlh", "nedoplat"],
  budget_accounting: ["rozpoct", "uctov", "ucetn", "zavierk", "zaverk", "hospodar"],
  heating_billing: ["vykur", "vytap", "tepl", "rozuct", "vyuct", "merac", "meric"],
  renovation_building: ["obnov", "rekonstr", "stavebn", "uver", "zatepl", "oprav(?:a|y|u|e|ach|ami)\\b", "vytah", "nadstavb"],
  administrator: ["spravc", "predsed", "vybor", "rad(?:a|y|e)\\b", "statutar"],
  gdpr: ["gdpr", "osobn", "kamer", "spracovan", "zpracovan"],
  ownership_general: ["vlastnic", "spoluvlast", "podiel", "jednotk", "prevod", "predaj", "najom", "najem"],
};

export function isLawTopic(value: unknown): value is LawTopic {
  return typeof value === "string" && (LAW_TOPICS as readonly string[]).includes(value);
}

const TOPIC_RES: ReadonlyArray<[LawTopic, RegExp]> = LAW_TOPICS.map((topic) => [
  topic,
  new RegExp(`(?:^|[^a-z0-9])(?:${TOPIC_KEYWORDS[topic].join("|")})`),
]);

/** Topics whose keywords appear at a word start of a folded question. */
export function inferTopics(foldedQuestion: string): LawTopic[] {
  return TOPIC_RES.filter(([, re]) => re.test(foldedQuestion)).map(([topic]) => topic);
}

/**
 * Topic-map entries that don't exist in the loaded data ("lawId" or
 * "lawId#anchor"). The search simply never matches them; this is only for a
 * warning after a re-sync.
 */
export function unknownTopicAnchors(
  jurisdiction: LawJurisdiction,
  provisionAnchors: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  const out = new Set<string>();
  for (const topic of LAW_TOPICS) {
    for (const src of TOPIC_SOURCES[topic][jurisdiction]) {
      const known = provisionAnchors.get(src.lawId);
      if (!known) {
        out.add(src.lawId);
        continue;
      }
      for (const a of src.anchors ?? []) if (!known.has(a)) out.add(`${src.lawId}#${a}`);
    }
  }
  return [...out];
}

/** lawId → on-topic provision anchors (null = whole act) for the given topics. */
export function topicScope(
  topics: readonly LawTopic[],
  jurisdiction: LawJurisdiction
): Map<string, Set<string> | null> {
  const scope = new Map<string, Set<string> | null>();
  for (const topic of topics) {
    for (const src of TOPIC_SOURCES[topic][jurisdiction]) {
      const prev = scope.get(src.lawId);
      if (prev === null) continue;
      if (!src.anchors) {
        scope.set(src.lawId, null);
        continue;
      }
      const set = prev ?? new Set<string>();
      for (const a of src.anchors) set.add(a);
      scope.set(src.lawId, set);
    }
  }
  return scope;
}
