// Client-safe, per-viewer reader preferences for /zakony, kept in
// localStorage. Pure convenience: every read/write is wrapped so the reader
// works the same with storage blocked (private mode, disabled site data).

export const LAW_FONT_SIZES = ["sm", "md", "lg"] as const;
export type LawFontSize = (typeof LAW_FONT_SIZES)[number];

const FONT_KEY = "oh.laws.fontSize";
/** Server-readable copy of the font size, so the first paint already has it (no layout jump). */
export const LAW_FONT_COOKIE = "oh_law_size";
const FONT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLawFontSize(v: unknown): v is LawFontSize {
  return (LAW_FONT_SIZES as readonly string[]).includes(String(v ?? ""));
}
const PROGRESS_KEY = "oh.laws.progress";
const PROGRESS_MAX = 20;

export interface LawProgressEntry {
  /** Chapter index (1-based). */
  chapter: number;
  /** Last provision anchor seen at the top of the viewport, if any. */
  anchor?: string;
  /** Epoch ms of the last update. */
  at: number;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preference just isn't remembered */
  }
}

/** Legacy localStorage value (before the cookie); used once to migrate. */
export function readFontSize(): LawFontSize | null {
  const v = read(FONT_KEY);
  return isLawFontSize(v) ? v : null;
}

export function writeFontSize(size: LawFontSize): void {
  write(FONT_KEY, size);
  try {
    document.cookie = `${LAW_FONT_COOKIE}=${size}; path=/; max-age=${FONT_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    /* cookies blocked — preference just isn't remembered */
  }
}

export function readProgress(): Record<string, LawProgressEntry> {
  const raw = read(PROGRESS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, LawProgressEntry> = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as Partial<LawProgressEntry> | null;
      if (e && typeof e.chapter === "number" && typeof e.at === "number") {
        out[id] = {
          chapter: e.chapter,
          at: e.at,
          ...(typeof e.anchor === "string" ? { anchor: e.anchor } : {}),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeProgress(lawId: string, entry: LawProgressEntry): void {
  const all = readProgress();
  all[lawId] = entry;
  // Keep only the most recent laws so the entry can't grow unbounded.
  const trimmed = Object.fromEntries(
    Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, PROGRESS_MAX),
  );
  write(PROGRESS_KEY, JSON.stringify(trimmed));
}
