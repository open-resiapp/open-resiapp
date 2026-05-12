// Pure name-normalisation + Jaccard similarity helper for matching
// imported LV (Kataster) names against bulk-QR self-registered names.
//
// LV names look like: "Mgr. r. Truchanová Hanzeliová Marcela", with
// titles, multiple maiden names ("r. <surname>"), Slovak diacritics, and
// surname-first order. Registrant inputs are usually clean
// "Given Surname" with or without diacritics. Goal is a tolerant
// order-independent comparison that surfaces obvious matches without
// false positives.

const ACADEMIC_TITLES = new Set([
  "mgr",
  "ing",
  "bc",
  "mudr",
  "judr",
  "rndr",
  "phdr",
  "phd",
  "drsc",
  "csc",
  "doc",
  "prof",
  "dr",
  "mvdr",
  "thdr",
  "paeddr",
  "akad",
  "art",
  "dipl",
  "kfm",
  // Honorifics that occasionally appear on LV
  "pan",
  "pani",
]);

// "r." marker introduces a maiden-name qualifier whose tokens should be
// ignored. We strip those segments before tokenising.
const MAIDEN_MARKER_REGEX = /\br\.\s*\S+/giu;

// Combining diacritical marks block (U+0300..U+036F). After NFKD,
// stripping these turns "Hricová" → "Hricova".
const COMBINING_MARKS_REGEX = /[̀-ͯ]/gu;

function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(COMBINING_MARKS_REGEX, "");
}

export function normaliseName(name: string): string[] {
  if (!name) return [];

  const withoutMaiden = name.replace(MAIDEN_MARKER_REGEX, " ");
  const ascii = stripDiacritics(withoutMaiden).toLowerCase();
  const rawTokens = ascii.split(/[^a-z]+/u).filter(Boolean);

  return rawTokens
    .map((tok) => tok.replace(/\.+$/g, ""))
    .filter((tok) => tok.length >= 2)
    .filter((tok) => !ACADEMIC_TITLES.has(tok));
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function nameSimilarity(left: string, right: string): number {
  return jaccardSimilarity(normaliseName(left), normaliseName(right));
}

export interface NameCandidate {
  id: string;
  name: string;
}

export interface RankedCandidate<T extends NameCandidate> {
  candidate: T;
  score: number;
}

// Returns candidates above `threshold` sorted by descending score.
// Caller decides what to do with the top entry (auto-suggest, etc.).
export function rankCandidates<T extends NameCandidate>(
  query: string,
  candidates: T[],
  threshold = 0.5
): RankedCandidate<T>[] {
  const queryTokens = normaliseName(query);
  if (queryTokens.length === 0) return [];

  const ranked: RankedCandidate<T>[] = [];
  for (const candidate of candidates) {
    const score = jaccardSimilarity(queryTokens, normaliseName(candidate.name));
    if (score >= threshold) {
      ranked.push({ candidate, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
