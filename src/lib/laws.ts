// Shared types for the laws library (`data/laws/**`). Client-safe: no
// server APIs here. The JSON files are produced by `pnpm laws:sync`
// (scripts/laws-sync.ts) and read on the server by `laws.server.ts`.
//
// Everything is plain text — the sync script strips all markup, so the
// UI renders strings only (no dangerouslySetInnerHTML anywhere).
//
// Anchors are stable identifiers meant to be cited (UI deep links today,
// MCP knowledge-base citations later):
//   provision  p14a            (§ 14a), cl2 (Čl. II), priloha1 (Príloha č. 1)
//   paragraph  p14a-4          (§ 14a ods. 4); unnumbered: p7-x1
//   item       p14a-4-a        (písm. a), nested points p2-1-b-1
//   section    s-<path>        (časť / hlava / diel / oddiel …)
//   footnote   fn-5a

export const LAW_JURISDICTIONS = ["sk", "cz"] as const;
export type LawJurisdiction = (typeof LAW_JURISDICTIONS)[number];

export function isLawJurisdiction(value: unknown): value is LawJurisdiction {
  return typeof value === "string" && (LAW_JURISDICTIONS as readonly string[]).includes(value);
}

export interface LawItem {
  anchor: string;
  /** Display label as in the source, e.g. "a)", "1.", "–". May be empty. */
  label: string;
  /** Anchor key derived from the label, e.g. "a", "1". */
  letter: string;
  text: string;
  items?: LawItem[];
  /** Text that follows the nested items inside the same item. */
  tail?: string;
}

export interface LawParagraph {
  anchor: string;
  /** Paragraph number without brackets ("4" for "(4)"); absent when unnumbered. */
  n?: string;
  text: string;
  items?: LawItem[];
  /** Text that follows the items inside the same paragraph. */
  tail?: string;
}

export interface LawProvision {
  type: "provision";
  anchor: string;
  /** "§ 14", "Čl. II", "Príloha č. 1 …" */
  label: string;
  heading?: string;
  paragraphs: LawParagraph[];
}

export interface LawSection {
  type: "section";
  anchor: string;
  /** Source structure kind: cast, hlava, diel, oddiel, group, clanok, prilohy … */
  kind: string;
  label?: string;
  heading?: string;
  children: LawNode[];
}

/** A heading that stands between provisions without opening a section. */
export interface LawHeading {
  type: "heading";
  anchor: string;
  text: string;
}

/** Free text outside any provision (e.g. the enacting formula). */
export interface LawText {
  type: "text";
  text: string;
}

export type LawNode = LawSection | LawProvision | LawHeading | LawText;

export interface LawFootnote {
  anchor: string;
  label: string;
  text: string;
}

export interface LawMeta {
  /** "sk-182-1993" */
  id: string;
  jurisdiction: LawJurisdiction;
  /** "182/1993 Z. z." / "89/2012 Sb." */
  number: string;
  title: string;
  /** ISO date the stored consolidated version is effective from. */
  effectiveFrom: string;
  /** ISO date the stored version stops being effective, when already known. */
  effectiveTo: string | null;
  /** Human-readable page of this exact version at the official source. */
  sourceUrl: string;
  /** ISO timestamp of the sync that produced the current content. */
  fetchedAt: string;
  /** sha256 of the structured content (parts + footnotes). */
  contentHash: string;
  /** Set when only part of the act is stored, e.g. "§ 1158 – § 1222 (bytové spoluvlastnictví)". */
  scope?: string;
  provisionCount: number;
}

export interface LawDocument extends LawMeta {
  parts: LawNode[];
  footnotes: LawFootnote[];
}

export interface LawIndex {
  generatedAt: string;
  laws: LawMeta[];
}
