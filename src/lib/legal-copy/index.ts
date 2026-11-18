// Client-safe, pure. BYT-20261118-020 — statute-dependent copy for the
// voting documents (notice, ballot, attendance list, minutes) per legal
// regime (template) + country.
//
// CLAUDE.md "UI patterns": legally regulated content MUST NOT be naively
// parametrized across templates. This module is the "separate
// template-aware content module" that rule asks for: every regime/country
// pair gets its OWN explicit entry, and a pair whose wording has not been
// signed off reports `signedOff: false` so the PDFs keep refusing to
// render it (memory: "Statutory docs need legal-copy sign-off gate").
//
// Values are i18n KEYS, never prose (next-intl rule). The HOA entries
// point at the exact keys / strings the documents use today, so wiring
// this module into the PDFs changes nothing for an SVB / SVJ:
//   notice title / legal basis  → VotingWorkflow.notice.title / .legalBasis
//   ballot heading / owner      → VotingWorkflow.ballotSheet.title / .owner
//   attendance heading          → MeetingAttendance.export.sheetFilled / .sheetBlank
//   minutes heading / column    → LegalCopy.hoa.minutesHeading ("ZÁPISNICA Z
//                                 HLASOVANIA") / LegalCopy.hoa.memberLabel
//                                 ("Vlastník") — today hard-coded Slovak in
//                                 VotingMinutesPDF; resolve these two with
//                                 locale "sk" to keep the output identical.
//
// TODO(legal-signoff): every LegalCopy.cooperative.* string (SK + CZ) and
// the cooperative citations below need sign-off before `signedOff` flips.

import {
  allowedVotingMethods,
  defaultVotingMethodFor,
  type CanonicalVotingMethod,
} from "@/lib/voting-method";
import {
  legalRegimeFor,
  toLegalCountry,
  type LegalCountry,
  type LegalRegime,
} from "./regime";

export { legalRegimeFor, toLegalCountry };
export type { LegalCountry, LegalRegime };

/** A provision in the bundled law library (data/laws, /zakony reader). */
export interface StatuteCitation {
  /** data/laws id, e.g. "sk-513-1991". */
  lawId: string;
  /** Reader anchor, e.g. "p239" (src/lib/laws-citation.ts provisionAnchor). */
  anchor: string;
  /** "239" — for formatCitation(). */
  section: string;
  /** What the provision governs, as an i18n key (LegalCopy.topics.*). */
  topicKey: string;
}

export interface LegalCopyKeys {
  /** Heading of the announcement / invitation document. */
  noticeTitle: string;
  /** Statute line printed in the notice footer. */
  noticeLegalBasis: string;
  /** Heading of the ballot sheet. */
  ballotHeading: string;
  /** Label of the person a ballot belongs to ("Vlastník" / "Člen"). */
  ballotMemberLabel: string;
  /** Heading of the filled attendance list. */
  attendanceHeading: string;
  /** Heading of the blank sign-in sheet. */
  attendanceBlankHeading: string;
  /** Minutes document heading. */
  minutesHeading: string;
  /** Singular person label in tables ("Vlastník" vs "Člen"). */
  memberLabel: string;
  /** Plural, for sentences ("vlastníkov" vs "členov"). */
  memberLabelPlural: string;
  /** Name of the assembly ("schôdza vlastníkov" / "členská schôdza"). */
  assemblyName: string;
}

export type LegalDocument = "notice" | "ballot" | "attendance" | "minutes";

export interface LegalCopy {
  regime: LegalRegime;
  country: LegalCountry;
  /**
   * Per document: false → it must not render for this pair (callers show
   * e.g. MEETING_EXPORT_UNAVAILABLE). Mirrors today's gates exactly for
   * HOA; the cooperative pairs wait for legal sign-off.
   */
  signedOff: Record<LegalDocument, boolean>;
  statuteCitations: StatuteCitation[];
  keys: LegalCopyKeys;
  /** Voting methods the settings UI may offer (statute-driven). */
  votingMethods: CanonicalVotingMethod[];
  defaultVotingMethod: CanonicalVotingMethod;
}

const HOA_KEYS: LegalCopyKeys = {
  noticeTitle: "VotingWorkflow.notice.title",
  noticeLegalBasis: "VotingWorkflow.notice.legalBasis",
  ballotHeading: "VotingWorkflow.ballotSheet.title",
  ballotMemberLabel: "VotingWorkflow.ballotSheet.owner",
  attendanceHeading: "MeetingAttendance.export.sheetFilled",
  attendanceBlankHeading: "MeetingAttendance.export.sheetBlank",
  minutesHeading: "LegalCopy.hoa.minutesHeading",
  memberLabel: "LegalCopy.hoa.memberLabel",
  memberLabelPlural: "LegalCopy.hoa.memberLabelPlural",
  assemblyName: "LegalCopy.hoa.assemblyName",
};

function cooperativeKeys(country: LegalCountry): LegalCopyKeys {
  const p = `LegalCopy.cooperative.${country}`;
  return {
    noticeTitle: `${p}.noticeTitle`,
    noticeLegalBasis: `${p}.noticeLegalBasis`,
    ballotHeading: `${p}.ballotHeading`,
    ballotMemberLabel: `${p}.memberLabel`,
    attendanceHeading: `${p}.attendanceHeading`,
    attendanceBlankHeading: `${p}.attendanceBlankHeading`,
    minutesHeading: `${p}.minutesHeading`,
    memberLabel: `${p}.memberLabel`,
    memberLabelPlural: `${p}.memberLabelPlural`,
    assemblyName: `${p}.assemblyName`,
  };
}

const cite = (lawId: string, section: string, topic: string): StatuteCitation => ({
  lawId,
  anchor: `p${section}`,
  section,
  topicKey: `LegalCopy.topics.${topic}`,
});

// Provisions verified against data/laws (laws:sync 2026-11-18).
const CITATIONS: Record<LegalRegime, Record<LegalCountry, StatuteCitation[]>> = {
  hoa: {
    sk: [
      cite("sk-182-1993", "14", "votes"), // §14 ods. 3: one vote per flat / nebytový priestor
      cite("sk-182-1993", "14a", "notice"), // §14a ods. 2: 7-day notice
      cite("sk-182-1993", "14b", "majorities"),
    ],
    cz: [
      cite("cz-89-2012", "1206", "votes"), // §1206: votes by share, quorum
      cite("cz-89-2012", "1207", "notice"),
      cite("cz-89-2012", "1214", "majorities"),
    ],
  },
  cooperative: {
    sk: [
      cite("sk-513-1991", "238", "quorum"), // ods. 3: majority present, majority of present votes
      cite("sk-513-1991", "239", "notice"), // ods. 2: convening per stanovy
      cite("sk-513-1991", "240", "votes"), // one member one vote unless stanovy
      cite("sk-513-1991", "241", "minutes"), // zápisnica + zoznam účastníkov
      cite("sk-513-1991", "243", "board"), // predstavenstvo
      cite("sk-513-1991", "244", "supervisory"), // kontrolná komisia
    ],
    cz: [
      cite("cz-90-2012", "636", "notice"), // ≥ 15 days, informační deska + mail
      cite("cz-90-2012", "644", "quorum"),
      cite("cz-90-2012", "645", "majorities"),
      cite("cz-90-2012", "653", "perRollam"), // 15-day response default
      cite("cz-90-2012", "755", "votes"), // bytové družstvo: 1 member 1 vote
    ],
  },
  other: { sk: [], cz: [] },
};

// Sign-off gate. Flip a cooperative entry only after the legal-copy review
// of LegalCopy.cooperative.<country>.* (spec BYT-20261118-020 AC 9).
// HOA rows = today's gates: notice + ballot SK HOA only
// (VotingDocuments.documentsAvailable), attendance any HOA
// (attendance.ts getAttendanceExport), minutes ungated.
const ALL_OFF: Record<LegalDocument, boolean> = {
  notice: false,
  ballot: false,
  attendance: false,
  minutes: false,
};
const SIGNED_OFF: Record<LegalRegime, Record<LegalCountry, Record<LegalDocument, boolean>>> = {
  hoa: {
    sk: { notice: true, ballot: true, attendance: true, minutes: true },
    cz: { notice: false, ballot: false, attendance: true, minutes: true },
  },
  cooperative: { sk: ALL_OFF, cz: ALL_OFF },
  // TODO(decision): minutes still render (with HOA wording) for the other
  // templates today — pre-existing; kept so this module changes nothing.
  other: {
    sk: { ...ALL_OFF, minutes: true },
    cz: { ...ALL_OFF, minutes: true },
  },
};

/**
 * Statute-dependent copy for `templateSlug` (entities.data.template_slug of
 * the community root; null on legacy installs = HOA) and `country`.
 */
export function getLegalCopy(
  templateSlug: string | null | undefined,
  country: string | null | undefined
): LegalCopy {
  const regime = legalRegimeFor(templateSlug);
  const c = toLegalCountry(country);
  return {
    regime,
    country: c,
    signedOff: SIGNED_OFF[regime][c],
    statuteCitations: CITATIONS[regime][c],
    // "other" templates have no statutory documents; they keep the neutral
    // HOA-shaped keys only so callers never get undefined.
    keys: regime === "cooperative" ? cooperativeKeys(c) : HOA_KEYS,
    votingMethods: allowedVotingMethods(regime, c),
    defaultVotingMethod: defaultVotingMethodFor(regime),
  };
}
