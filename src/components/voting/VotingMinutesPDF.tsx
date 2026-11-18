import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
} from "@react-pdf/renderer";
import type { VotingResults, QuorumType } from "@/types";
import type { MinutesProtocol } from "@modules/voting/src/workflow/minutes";
import { resultBasis } from "@modules/voting/src/workflow/result-basis";

// Register Roboto for Slovak diacritics
Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: {
    fontFamily: "Roboto",
    fontSize: 10,
    padding: 40,
    color: "#1a1a1a",
  },
  header: {
    marginBottom: 20,
    textAlign: "center",
  },
  buildingName: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 4,
  },
  buildingAddress: {
    fontSize: 10,
    color: "#555",
    marginBottom: 2,
  },
  buildingIco: {
    fontSize: 9,
    color: "#777",
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 20,
    color: "#333",
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 4,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  metaLabel: {
    width: 160,
    fontSize: 9,
    color: "#555",
  },
  metaValue: {
    flex: 1,
    fontSize: 9,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#f9f9f9",
    borderRadius: 2,
  },
  resultLabel: {
    fontSize: 10,
    fontWeight: 700,
  },
  resultValue: {
    fontSize: 10,
  },
  passedBadge: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: 700,
    paddingVertical: 8,
    marginTop: 8,
    borderRadius: 4,
  },
  passed: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  notPassed: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  },
  // Vote table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  colNum: { width: 25, fontSize: 8 },
  colFlat: { width: 40, fontSize: 8 },
  colOwner: { width: 100, fontSize: 8 },
  colChoice: { width: 60, fontSize: 8 },
  colType: { width: 55, fontSize: 8 },
  colDate: { width: 75, fontSize: 8 },
  colHash: { flex: 1, fontSize: 6, color: "#777" },
  headerText: { fontWeight: 700, fontSize: 8 },
  // BYT-20261117-002 Phase 6: confirmation line under an electronic ballot.
  ballotRowBlock: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  ballotRowCells: { flexDirection: "row" },
  confirmationLine: { fontSize: 7, color: "#555", marginTop: 1, marginLeft: 20 },
  mandateRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: "#faf5ff",
    borderRadius: 2,
  },
  mandateText: {
    fontSize: 9,
  },
  unitBreakdownBlock: {
    marginBottom: 6,
    padding: 6,
    backgroundColor: "#f9fafb",
    borderRadius: 2,
    borderLeftWidth: 2,
    borderLeftColor: "#9ca3af",
  },
  unitBreakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
    fontSize: 10,
    fontWeight: 700,
  },
  unitBreakdownOwner: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 9,
    paddingVertical: 1,
  },
  unitBreakdownRationale: {
    fontSize: 8,
    fontStyle: "italic",
    color: "#555",
    marginTop: 3,
  },
  legalNotice: {
    marginTop: 16,
    padding: 10,
    backgroundColor: "#eff6ff",
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: "#3b82f6",
  },
  legalNoticeText: {
    fontSize: 8,
    color: "#1e40af",
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  footerText: {
    fontSize: 7,
    color: "#999",
  },
  qrContainer: {
    alignItems: "flex-end",
  },
  qrImage: {
    width: 60,
    height: 60,
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 7,
    color: "#999",
  },
});

const extra = StyleSheet.create({
  weightRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: "#f9f9f9",
    borderRadius: 2,
  },
  wLabel: { width: 90, fontSize: 10, fontWeight: 700 },
  wValue: { width: 90, fontSize: 10, textAlign: "right" },
  wPct: { flex: 1, fontSize: 10, textAlign: "right" },
  thresholdLine: { fontSize: 9, marginTop: 2, marginBottom: 4, color: "#333" },
  paragraph: { fontSize: 9, marginBottom: 4, lineHeight: 1.4 },
  signatureBlock: { marginTop: 14, flexDirection: "row", alignItems: "flex-end" },
  signatureRole: { width: 110, fontSize: 9, color: "#555" },
  signatureName: { width: 150, fontSize: 9 },
  signatureLine: { flex: 1, borderBottomWidth: 0.75, borderBottomColor: "#333", height: 14 },
  refusal: { fontSize: 8, color: "#991b1b", marginTop: 2, marginLeft: 110 },
});

// ──────────────────────────────────────────────────────────────────────────
// MINUTES_LEGAL_COPY_SK — every statutory / document string of the minutes
// in ONE place, so a template-aware legal-copy module (src/lib/legal-copy,
// in progress) can swap it later. SK HOA wording, zák. 182/1993 Z.z.
//
// TODO(legal-copy sign-off): the §14a ods. 8 / ods. 9 sections added on
// 2026-11-18 (place + term, attendance, adopted decisions, publication date,
// signature lines, attachments, refusal statements) and the result-basis
// lines ("potrebné: …") are NOT yet signed off. Plumbing-green ≠ legally
// correct — do not ship to production communities before the sign-off.
// ──────────────────────────────────────────────────────────────────────────
export const MINUTES_LEGAL_COPY_SK = {
  title: "ZÁPISNICA Z HLASOVANIA",
  titleMeeting: "ZÁPISNICA ZO SCHÔDZE VLASTNÍKOV",
  titleWritten: "ZÁPISNICA Z PÍSOMNÉHO HLASOVANIA",
  entrance: "Hlasovanie pre vchod:",
  ico: "IČO:",
  metaHeading: "Údaje o hlasovaní",
  votingType: "Typ hlasovania:",
  initiator: "Iniciátor:",
  itemCount: "Počet bodov:",
  period: "Obdobie:",
  createdBy: "Vytvoril:",
  // §14a ods. 8 písm. a): termín a miesto konania.
  meetingTerm: "Termín konania schôdze:",
  writtenTerm: "Termín písomného hlasovania:",
  place: "Miesto konania:",
  notStated: "neuvedené",
  votingTypes: { written: "Písomné", meeting: "Na schôdzi" } as Record<string, string>,
  initiators: {
    board: "Správca / správna rada",
    owners_quarter: "Štvrtina vlastníkov",
  } as Record<string, string>,
  quorumTypes: {
    simple_present: "Nadpolovičná väčšina prítomných",
    simple_all: "Nadpolovičná väčšina všetkých",
    two_thirds_all: "Dvojtretinová väčšina všetkých",
    four_fifths_all: "Štvorpätinová väčšina všetkých",
    all_unanimous: "Súhlas všetkých (100%)",
  } as Record<QuorumType, string>,
  choices: { za: "ZA", proti: "PROTI", zdrzal_sa: "ZDRŽAL SA" } as Record<string, string>,
  // Attendance (meeting) — §14a ods. 8 annex: prezenčná listina.
  attendanceHeading: "Prítomnosť na schôdzi",
  attendanceEligible: "Vlastníci oprávnení hlasovať:",
  attendancePresent: "Prítomní osobne:",
  attendanceRepresented: "Zastúpení splnomocnencom:",
  attendanceAbsent: "Neprítomní:",
  attendanceShare: "Podiel hlasov prítomných a zastúpených:",
  attendanceTallyBasis: "Základ pre výpočet výsledku (prítomní):",
  attendanceBasisList: "podľa prezenčnej listiny",
  attendanceBasisCast: "prezenčná listina nebola vyplnená – podľa odovzdaných hlasov",
  owners: "vlastníkov",
  ofAllVotes: "všetkých hlasov",
  // Per item.
  item: "Bod",
  quorumType: "Potrebná väčšina:",
  weightHeader: "Váha hlasov",
  ofCounted: "zo započítaných",
  ofAll: "zo všetkých",
  ofPresent: "z prítomných",
  counted: "Započítané hlasy (váha):",
  presentWeight: "Prítomní (váha):",
  totalPossible: "Všetky hlasy v rozsahu hlasovania (váha):",
  // Result basis — mirrors engine/index.ts finalizeTally (result-basis.ts).
  thresholdAll: {
    more_than_half: (pct: string, w: string) => `Potrebné na prijatie: viac ako ${pct} % všetkých hlasov (viac ako ${w}).`,
    at_least_two_thirds: (pct: string, w: string) => `Potrebné na prijatie: aspoň dve tretiny (${pct} %) všetkých hlasov (aspoň ${w}).`,
    at_least_four_fifths: (pct: string, w: string) => `Potrebné na prijatie: aspoň štyri pätiny (${pct} %) všetkých hlasov (aspoň ${w}).`,
    all: (pct: string, w: string) => `Potrebný je súhlas všetkých vlastníkov (${pct} %, ${w}).`,
  },
  thresholdPresent: (pct: string, w: string) => `Potrebné na prijatie: viac ako ${pct} % hlasov prítomných (viac ako ${w}).`,
  thresholdCast: (pct: string, w: string) => `Potrebné na prijatie: viac ako ${pct} % hlasov vlastníkov, ktorí hlasovali (viac ako ${w}).`,
  quorum: "Kvórum",
  quorumReached: "DOSIAHNUTÉ",
  quorumNotReached: "NEDOSIAHNUTÉ",
  passed: "SCHVÁLENÉ",
  notPassed: "NESCHVÁLENÉ",
  owner: "Vlastník",
  vote: "Hlas",
  auditHash: "Audit hash",
  coOwner: "Spoluvlastník",
  share: "podiel",
  resolution: "Výsledok:",
  rationale: {
    single_owner: "Jediný vlastník",
    unanimous: "Jednomyseľný hlas všetkých spoluvlastníkov",
    majority_share: "Väčšina spoluvlastníckych podielov",
    tie_abstain: "Rovnosť podielov — byt sa zdržal podľa §14 ods. 4 zák. 182/1993 Z.z.",
    no_quorum_within_unit: "Bez vyjadrenia spoluvlastníkov",
  } as Record<string, string>,
  rationaleCZ: {
    single_owner: "Jediný vlastník",
    unanimous: "Jednomyslný hlas všech spoluvlastníků",
    majority_share: "Většina spoluvlastnických podílů",
    tie_abstain: "Rovnost podílů — jednotka se zdržela podle §1187 zák. č. 89/2012 Sb.",
    no_quorum_within_unit: "Žádný spoluvlastník nehlasoval",
  } as Record<string, string>,
  // §14a ods. 8 písm. c): znenie prijatých rozhodnutí.
  adoptedHeading: "Znenie prijatých rozhodnutí",
  adoptedNone: "Žiadne rozhodnutie nebolo prijaté.",
  // Ballots.
  ballotsHeading: "Odovzdané hlasovacie lístky (podpisy)",
  type: "Typ",
  date: "Dátum",
  ballotHash: "Odtlačok volieb",
  paper: "Listinný",
  electronic: "Elektronický",
  ballotHashNote:
    "Odtlačok volieb (SHA-256) zachytáva voľby na lístku, nie osobu — lístky s rovnakými voľbami majú rovnaký odtlačok. Každý hlas jednoznačne identifikuje audit hash pri príslušnom bode.",
  // §14a ods. 8: plnomocenstvá (annex) — §14 ods. 4 power of attorney.
  mandatesHeading: "Splnomocnenia",
  representedBy: "v zastúpení:",
  externalProxy: "splnomocnenec (nie je vlastníkom)",
  // §14a ods. 8: reopen statements, ods. 9: publication date.
  reopenHeading: "Opätovné otvorenie hlasovania",
  publishedOn: "Dátum zverejnenia výsledku hlasovania:",
  notYetPublished: "výsledok zatiaľ nebol zverejnený",
  // §14a ods. 8 annexes.
  annexHeading: "Prílohy zápisnice",
  annexAttendance: "originál prezenčnej listiny zo schôdze vlastníkov",
  annexBallots: "originál hlasovacej listiny (listín) z písomného hlasovania",
  annexElectronic: "menný zoznam vlastníkov, ktorí hlasovali elektronicky",
  annexMandates: "plnomocenstvá",
  annexRefusal: "meno, priezvisko a vyjadrenie overovateľa, ktorý odmietol podpísať zápisnicu",
  electronicHeading: "Menný zoznam vlastníkov, ktorí hlasovali elektronicky",
  electronicNone: "Elektronicky nehlasoval žiadny vlastník.",
  // §14a ods. 8 písm. f): meno, priezvisko a podpisy.
  signaturesHeading: "Podpisy",
  roleChair: "Predsedajúci:",
  roleRecorder: "Zapisovateľ:",
  roleVerifier: "Overovateľ:",
  refusedToSign: "Odmietol podpísať zápisnicu. Vyjadrenie:",
  legalBasis: "Zápisnica podľa § 14a ods. 8 zákona č. 182/1993 Z.z. o vlastníctve bytov a nebytových priestorov.",
  generated: "Vygenerované:",
} as const;

const C = MINUTES_LEGAL_COPY_SK;

// BYT-20260609-008: one signed ballot per owner-share (covers all items).
export interface BallotRowPDF {
  id: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  recordedAt: string;
  ballotHash: string;
  /**
   * BYT-20261117-002 Phase 6: how and when an electronic ballot was
   * confirmed, already worded by the caller (passkey / e-mail link / legacy
   * "without confirmation"). Absent for paper ballots.
   */
  confirmation?: string | null;
}

// BYT-20260609-008: per-item (resolution) result + its own vote list.
export interface ItemVotePDF {
  flatNumber: string;
  ownerName: string | null;
  choice: string;
  itemAuditHash: string;
}

export interface ItemResultPDF {
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
  result: VotingResults;
  votes: ItemVotePDF[];
}

export interface MandateRowPDF {
  id: string;
  fromOwnerName: string | null;
  fromFlatNumber: string | null;
  /** Owner account name, or the external proxy's name (2026-11-18). */
  toOwnerName: string | null;
  /** True when the proxy is not an owner account (mod_voting_mandates.proxy_name). */
  isExternalProxy?: boolean;
  isActive?: boolean;
}

export interface VotingPDF {
  title: string;
  votingType: string;
  initiatedBy: string;
  startsAt: string;
  endsAt: string;
  createdBy: { name: string } | null;
}

export interface BuildingPDF {
  name: string;
  address: string;
  ico: string | null;
}

interface VotingMinutesPDFProps {
  building: BuildingPDF;
  voting: VotingPDF;
  /** BYT-20260609-008: one section per item (resolution). */
  items: ItemResultPDF[];
  /** One signed ballot per owner-share (the single signature per owner). */
  ballots: BallotRowPDF[];
  mandates: MandateRowPDF[];
  legalNotice: string | null;
  qrDataUrl: string | null;
  generatedAt: string;
  entranceName?: string | null;
  country?: "sk" | "cz";
  /** unitEntityId → flat number, used to render multi-owner breakdown. */
  flatNumbersByUnitId?: Record<string, string>;
  /**
   * BYT-20260515-001 Phase 7b: label for the unit/leaf in the
   * generated PDF. Defaults to "Byt" (HOA). Legal rationale labels
   * (§14 ods. 4) stay HOA-specific by design.
   */
  unitLabel?: string;
  /** BYT-20261118-002 §7: place, officials, e-voters, reopenings, publication, attendance. */
  protocol?: MinutesProtocol;
  /**
   * 2026-11-18: print the §14a ods. 8 zák. 182/1993 Z.z. protocol sections
   * (term + place, attendance, adopted decisions, e-voter list, publication
   * date, annexes, signature lines). The caller sets it ONLY for the SK HOA
   * template — the statute does not apply to CZ or non-HOA communities
   * (CLAUDE.md: legally regulated content is not parametrized).
   */
  statutory?: boolean;
  /**
   * BYT-20261118-020: regime heading / person label resolved by the caller
   * from src/lib/legal-copy (LegalCopyKeys.minutesHeading / .memberLabel).
   * Omitted = the SK HOA wording (C.title / C.owner — identical to
   * LegalCopy.hoa.* in locale "sk"), so HOA output stays byte-identical.
   * The caller renders the minutes only when lc.signedOff.minutes.
   */
  minutesHeading?: string;
  memberLabel?: string;
}

const nf = (n: number, digits: number) =>
  n.toLocaleString("sk-SK", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const weightFmt = (n: number) => nf(n, 4);
const pctFmt = (n: number) => nf(n, 1);

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("sk-SK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("sk-SK", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

/** Per-item result: absolute weights + shares of counted AND of the verdict's basis. */
function ItemResultBlock({ r }: { r: VotingResults }) {
  const b = resultBasis(r);
  const basisLabel = b.kind === "all" ? C.ofAll : b.kind === "present" ? C.ofPresent : null;
  const rows: [string, number, number, number][] = [
    [C.choices.za, r.za, r.zaPercent, b.zaOfBasisPct],
    [C.choices.proti, r.proti, r.protiPercent, b.protiOfBasisPct],
    [C.choices.zdrzal_sa, r.zdrzalSa, r.zdrzalSaPercent, b.zdrzalSaOfBasisPct],
  ];
  const thr = pctFmt(b.thresholdPct);
  const thrW = weightFmt(b.thresholdWeight);
  const thresholdText =
    b.kind === "all"
      ? C.thresholdAll[b.threshold](thr, thrW)
      : b.kind === "present"
        ? C.thresholdPresent(thr, thrW)
        : C.thresholdCast(thr, thrW);
  return (
    <View>
      <View style={[extra.weightRow, { backgroundColor: "#f3f4f6" }]}>
        <Text style={extra.wLabel}> </Text>
        <Text style={[extra.wValue, styles.headerText]}>{C.weightHeader}</Text>
        <Text style={[extra.wPct, styles.headerText]}>{C.ofCounted}</Text>
        {basisLabel && <Text style={[extra.wPct, styles.headerText]}>{basisLabel}</Text>}
      </View>
      {rows.map(([label, w, ofCounted, ofBasis]) => (
        <View key={label} style={extra.weightRow}>
          <Text style={extra.wLabel}>{label}</Text>
          <Text style={extra.wValue}>{weightFmt(w)}</Text>
          <Text style={extra.wPct}>{pctFmt(ofCounted)} %</Text>
          {basisLabel && <Text style={extra.wPct}>{pctFmt(ofBasis)} %</Text>}
        </View>
      ))}
      <MetaRow label={C.counted} value={weightFmt(b.countedWeight)} />
      {b.kind === "present" && <MetaRow label={C.presentWeight} value={weightFmt(b.basisWeight)} />}
      <MetaRow label={C.totalPossible} value={weightFmt(b.totalPossibleWeight)} />
      <Text style={extra.thresholdLine}>{thresholdText}</Text>
    </View>
  );
}

function SignatureLine({ role, name, refusal }: { role: string; name: string; refusal?: string | null }) {
  return (
    <View wrap={false}>
      <View style={extra.signatureBlock}>
        <Text style={extra.signatureRole}>{role}</Text>
        <Text style={extra.signatureName}>{name}</Text>
        <View style={extra.signatureLine} />
      </View>
      {refusal !== undefined && refusal !== null ? (
        <Text style={extra.refusal}>
          {C.refusedToSign} {refusal || "—"}
        </Text>
      ) : null}
    </View>
  );
}

export default function VotingMinutesPDF({
  building: bld,
  voting,
  items,
  ballots,
  mandates: mandateRows,
  legalNotice,
  qrDataUrl,
  generatedAt,
  entranceName,
  country = "sk",
  flatNumbersByUnitId = {},
  unitLabel = "Byt",
  protocol,
  statutory = false,
  minutesHeading,
  memberLabel,
}: VotingMinutesPDFProps) {
  const rationaleSet = country === "cz" ? C.rationaleCZ : C.rationale;
  const isMeeting = voting.votingType === "meeting";
  const showProtocol = statutory && protocol !== undefined;
  const officials = protocol?.officials ?? [];
  const chairs = officials.filter((o) => o.role === "chair");
  const recorders = officials.filter((o) => o.role === "recorder");
  const verifiers = officials.filter((o) => o.role === "verifier");
  const activeMandates = mandateRows.filter((m) => m.isActive !== false);
  const adopted = items.filter((i) => i.result?.passed);
  const att = protocol?.attendance ?? null;
  const presence = protocol?.presence ?? null;
  const title = showProtocol ? (isMeeting ? C.titleMeeting : C.titleWritten) : (minutesHeading ?? C.title);
  const ownerLabel = memberLabel ?? C.owner;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.buildingName}>{bld.name}</Text>
          <Text style={styles.buildingAddress}>{bld.address}</Text>
          {bld.ico && <Text style={styles.buildingIco}>{C.ico} {bld.ico}</Text>}
        </View>

        {/* Title */}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{voting.title}</Text>
        {entranceName && (
          <Text style={{ fontSize: 10, textAlign: "center" as const, marginBottom: 16, color: "#555" }}>
            {C.entrance} {entranceName}
          </Text>
        )}

        {/* Metadata */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{C.metaHeading}</Text>
          <MetaRow label={C.votingType} value={C.votingTypes[voting.votingType] || voting.votingType} />
          <MetaRow label={C.initiator} value={C.initiators[voting.initiatedBy] || voting.initiatedBy} />
          <MetaRow label={C.itemCount} value={String(items.length)} />
          {showProtocol ? (
            <>
              {/* §14a ods. 8 písm. a): termín a miesto konania */}
              <MetaRow
                label={isMeeting ? C.meetingTerm : C.writtenTerm}
                value={
                  isMeeting
                    ? formatDateTime(voting.startsAt)
                    : `${formatDate(voting.startsAt)} — ${formatDate(voting.endsAt)}`
                }
              />
              <MetaRow label={C.place} value={protocol?.place || C.notStated} />
            </>
          ) : (
            <MetaRow label={C.period} value={`${formatDate(voting.startsAt)} — ${formatDate(voting.endsAt)}`} />
          )}
          <MetaRow label={C.createdBy} value={voting.createdBy?.name || "—"} />
        </View>

        {/* Attendance — meeting only, from the attendance list frozen at close
            and the presence the tally actually used (engine result). */}
        {showProtocol && isMeeting && (att || presence) && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{C.attendanceHeading}</Text>
            {att && (
              <>
                <MetaRow label={C.attendanceEligible} value={String(att.eligibleOwners)} />
                <MetaRow label={C.attendancePresent} value={String(att.presentOwners)} />
                <MetaRow label={C.attendanceRepresented} value={String(att.representedOwners)} />
                <MetaRow label={C.attendanceAbsent} value={String(att.absentOwners)} />
                <MetaRow
                  label={C.attendanceShare}
                  value={`${pctFmt(att.eligibleWeight > 0 ? (att.presentWeight / att.eligibleWeight) * 100 : 0)} % ${C.ofAllVotes} (${weightFmt(att.presentWeight)} / ${weightFmt(att.eligibleWeight)})`}
                />
              </>
            )}
            {presence && (
              <MetaRow
                label={C.attendanceTallyBasis}
                value={`${presence.presentOwners} ${C.owners}, ${pctFmt(presence.presentShare * 100)} % ${C.ofAllVotes} — ${
                  presence.basis === "attendance" ? C.attendanceBasisList : C.attendanceBasisCast
                }`}
              />
            )}
          </View>
        )}

        {/* Per-item (resolution) sections — each with its own quorum,
            result, vote list and §14/§1187 co-owner breakdown. */}
        {items.map((item) => {
          const r = item.result;
          const multiOwner =
            r.unitBreakdowns?.filter((u) => u.hasMultipleOwners) ?? [];
          return (
            <View key={item.idx} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {`${C.item} ${item.idx + 1}: ${item.title}`}
              </Text>
              {item.description && (
                <Text style={{ fontSize: 9, color: "#555", marginBottom: 6 }}>
                  {item.description}
                </Text>
              )}
              <MetaRow label={C.quorumType} value={C.quorumTypes[item.quorumType] || item.quorumType} />

              <ItemResultBlock r={r} />

              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>{C.quorum}</Text>
                <Text style={styles.resultValue}>
                  {r.quorumReached ? C.quorumReached : C.quorumNotReached}
                </Text>
              </View>
              <Text
                style={[styles.passedBadge, r.passed ? styles.passed : styles.notPassed]}
              >
                {r.passed ? C.passed : C.notPassed}
              </Text>

              {/* Per-item vote list */}
              {item.votes.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.colNum, styles.headerText]}>#</Text>
                    <Text style={[styles.colFlat, styles.headerText]}>{unitLabel}</Text>
                    <Text style={[styles.colOwner, styles.headerText]}>{ownerLabel}</Text>
                    <Text style={[styles.colChoice, styles.headerText]}>{C.vote}</Text>
                    <Text style={[styles.colHash, styles.headerText]}>{C.auditHash}</Text>
                  </View>
                  {item.votes.map((v, i) => (
                    <View key={i} style={styles.tableRow} wrap={false}>
                      <Text style={styles.colNum}>{i + 1}</Text>
                      <Text style={styles.colFlat}>{v.flatNumber}</Text>
                      <Text style={styles.colOwner}>{v.ownerName || "—"}</Text>
                      <Text style={styles.colChoice}>
                        {C.choices[v.choice] || v.choice}
                      </Text>
                      <Text style={styles.colHash}>{v.itemAuditHash}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Per-item co-owner (§14 ods. 4 / §1187) breakdown */}
              {multiOwner.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  {multiOwner.map((u) => {
                    const flatNumber = flatNumbersByUnitId[u.unitEntityId];
                    return (
                      <View
                        key={u.unitEntityId}
                        style={styles.unitBreakdownBlock}
                        wrap={false}
                      >
                        <View style={styles.unitBreakdownHeader}>
                          <Text>
                            {unitLabel} {flatNumber ?? u.unitEntityId.slice(0, 8)}
                          </Text>
                          <Text>{C.resolution} {C.choices[u.resolved]}</Text>
                        </View>
                        {u.breakdown.map((b, i) => (
                          <View key={i} style={styles.unitBreakdownOwner}>
                            <Text>
                              {b.userName ?? C.coOwner} ({C.share}{" "}
                              {b.ownerShareNumerator}/{b.ownerShareDenominator})
                            </Text>
                            <Text>{C.choices[b.choice]}</Text>
                          </View>
                        ))}
                        <Text style={styles.unitBreakdownRationale}>
                          {rationaleSet[u.rationale]}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {/* §14a ods. 8 písm. c): znenie prijatých rozhodnutí */}
        {showProtocol && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{C.adoptedHeading}</Text>
            {adopted.length === 0 ? (
              <Text style={extra.paragraph}>{C.adoptedNone}</Text>
            ) : (
              adopted.map((i) => (
                <View key={i.idx} wrap={false} style={{ marginBottom: 4 }}>
                  <Text style={[extra.paragraph, { fontWeight: 700, marginBottom: 1 }]}>
                    {`${C.item} ${i.idx + 1}: ${i.title}`}
                  </Text>
                  {i.description ? <Text style={extra.paragraph}>{i.description}</Text> : null}
                </View>
              ))
            )}
          </View>
        )}

        {/* Signatures — one signed ballot per owner-share (covers all items) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{C.ballotsHeading}</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.colNum, styles.headerText]}>#</Text>
            <Text style={[styles.colFlat, styles.headerText]}>{unitLabel}</Text>
            <Text style={[styles.colOwner, styles.headerText]}>{ownerLabel}</Text>
            <Text style={[styles.colType, styles.headerText]}>{C.type}</Text>
            <Text style={[styles.colDate, styles.headerText]}>{C.date}</Text>
            <Text style={[styles.colHash, styles.headerText]}>{C.ballotHash}</Text>
          </View>
          {ballots.map((b, i) => (
            <View key={b.id} style={styles.ballotRowBlock} wrap={false}>
              <View style={styles.ballotRowCells}>
                <Text style={styles.colNum}>{i + 1}</Text>
                <Text style={styles.colFlat}>{b.flatNumber}</Text>
                <Text style={styles.colOwner}>{b.ownerName || "—"}</Text>
                <Text style={styles.colType}>
                  {b.voteType === "paper" ? C.paper : C.electronic}
                </Text>
                <Text style={styles.colDate}>{formatDateTime(b.recordedAt)}</Text>
                <Text style={styles.colHash}>{b.ballotHash}</Text>
              </View>
              {b.confirmation ? (
                <Text style={styles.confirmationLine}>{b.confirmation}</Text>
              ) : null}
            </View>
          ))}
          <Text style={styles.confirmationLine}>{C.ballotHashNote}</Text>
        </View>

        {/* §14a ods. 8: menný zoznam vlastníkov, ktorí hlasovali elektronicky */}
        {showProtocol && !isMeeting && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{C.electronicHeading}</Text>
            {(protocol?.electronicVoters ?? []).length === 0 ? (
              <Text style={extra.paragraph}>{C.electronicNone}</Text>
            ) : (
              (protocol?.electronicVoters ?? []).map((e, i) => (
                <Text key={i} style={extra.paragraph}>
                  {`${i + 1}. ${e.ownerName || "—"} (${unitLabel} ${e.flatNumber})`}
                </Text>
              ))
            )}
          </View>
        )}

        {/* Mandates (§14 ods. 4) */}
        {activeMandates.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{C.mandatesHeading}</Text>
            {activeMandates.map((m) => (
              <View key={m.id} style={styles.mandateRow} wrap={false}>
                <Text style={styles.mandateText}>
                  {`${unitLabel} ${m.fromFlatNumber ?? "—"} (${m.fromOwnerName ?? "—"}) — ${C.representedBy} ${
                    m.toOwnerName ?? "—"
                  }${m.isExternalProxy ? ` (${C.externalProxy})` : ""}`}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Reopen statements + §14a ods. 9 publication date */}
        {showProtocol && (protocol?.reopenings ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{C.reopenHeading}</Text>
            {(protocol?.reopenings ?? []).map((r, i) => (
              <Text key={i} style={extra.paragraph}>
                {`${formatDateTime(r.at)}${r.note ? ` — ${r.note}` : ""}`}
              </Text>
            ))}
          </View>
        )}
        {showProtocol && (
          <View style={styles.section}>
            <MetaRow
              label={C.publishedOn}
              value={protocol?.resultPublishedAt ? formatDate(protocol.resultPublishedAt) : C.notYetPublished}
            />
          </View>
        )}

        {/* §14a ods. 8 annexes */}
        {showProtocol && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{C.annexHeading}</Text>
            <Text style={extra.paragraph}>{`1. ${isMeeting ? C.annexAttendance : C.annexBallots}`}</Text>
            {!isMeeting && <Text style={extra.paragraph}>{`2. ${C.annexElectronic}`}</Text>}
            {activeMandates.length > 0 && (
              <Text style={extra.paragraph}>{`${isMeeting ? 2 : 3}. ${C.annexMandates}`}</Text>
            )}
            {verifiers.some((v) => v.refusedToSign) && (
              <Text style={extra.paragraph}>{`${(isMeeting ? 2 : 3) + (activeMandates.length > 0 ? 1 : 0)}. ${C.annexRefusal}`}</Text>
            )}
          </View>
        )}

        {/* §14a ods. 8 písm. f): meno, priezvisko a podpisy */}
        {showProtocol && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{C.signaturesHeading}</Text>
            {(isMeeting || chairs.length > 0) &&
              (chairs.length > 0 ? chairs : [{ name: "" }]).map((o, i) => (
                <SignatureLine key={`c${i}`} role={C.roleChair} name={o.name} />
              ))}
            {(recorders.length > 0 ? recorders : [{ name: "" }]).map((o, i) => (
              <SignatureLine key={`r${i}`} role={C.roleRecorder} name={o.name} />
            ))}
            {(verifiers.length > 0
              ? verifiers
              : [
                  { name: "", refusedToSign: false, refusalStatement: null },
                  { name: "", refusedToSign: false, refusalStatement: null },
                ]
            ).map((o, i) => (
              <SignatureLine
                key={`v${i}`}
                role={C.roleVerifier}
                name={o.name}
                refusal={o.refusedToSign ? o.refusalStatement ?? "" : null}
              />
            ))}
            <Text style={[styles.confirmationLine, { marginLeft: 0, marginTop: 10 }]}>{C.legalBasis}</Text>
          </View>
        )}

        {/* Legal notice */}
        {legalNotice && (
          <View style={styles.legalNotice} wrap={false}>
            <Text style={styles.legalNoticeText}>{legalNotice}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <View>
            <Text style={styles.footerText}>
              {C.generated} {generatedAt}
            </Text>
            <Text style={styles.footerText}>OpenResiApp</Text>
          </View>
          {qrDataUrl && (
            <View style={styles.qrContainer}>
              <Image style={styles.qrImage} src={qrDataUrl} />
            </View>
          )}
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
