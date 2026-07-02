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

const choiceLabels: Record<string, string> = {
  za: "ZA",
  proti: "PROTI",
  zdrzal_sa: "ZDRŽAL SA",
};

const votingTypeLabels: Record<string, string> = {
  written: "Písomné",
  meeting: "Na schôdzi",
};

const initiatedByLabels: Record<string, string> = {
  board: "Správca / správna rada",
  owners_quarter: "Štvrtina vlastníkov",
};

const quorumTypeLabels: Record<QuorumType, string> = {
  simple_present: "Nadpolovičná väčšina prítomných",
  simple_all: "Nadpolovičná väčšina všetkých",
  two_thirds_all: "Dvojtretinová väčšina všetkých",
  all_unanimous: "Súhlas všetkých (100%)",
};

// BYT-20260609-008: one signed ballot per owner-share (covers all items).
export interface BallotRowPDF {
  id: string;
  ownerName: string | null;
  flatNumber: string;
  voteType: string;
  recordedAt: string;
  ballotHash: string;
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
  toOwnerName: string | null;
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
   * generated PDF. Defaults to "Byt" (HOA). For non-HOA installs the
   * caller passes the translated leaf-kind label so the document
   * doesn't say "Byt 12" against a garage or storage unit. Legal
   * rationale labels (§14 ods. 4) stay HOA-specific by design — they
   * carry statutory citations that don't apply to other templates.
   */
  unitLabel?: string;
}

const choiceLabelsResolution: Record<string, string> = {
  za: "ZA",
  proti: "PROTI",
  zdrzal_sa: "ZDRŽAL SA",
};

const rationaleLabels: Record<string, string> = {
  single_owner: "Jediný vlastník",
  unanimous: "Jednomyseľný hlas všetkých spoluvlastníkov",
  majority_share: "Väčšina spoluvlastníckych podielov",
  tie_abstain: "Rovnosť podielov — byt sa zdržal podľa §14 ods. 4 zák. 182/1993 Z.z.",
  no_quorum_within_unit: "Bez vyjadrenia spoluvlastníkov",
};

const rationaleLabelsCZ: Record<string, string> = {
  single_owner: "Jediný vlastník",
  unanimous: "Jednomyslný hlas všech spoluvlastníků",
  majority_share: "Většina spoluvlastnických podílů",
  tie_abstain: "Rovnost podílů — jednotka se zdržela podle §1187 zák. č. 89/2012 Sb.",
  no_quorum_within_unit: "Žádný spoluvlastník nehlasoval",
};

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
}: VotingMinutesPDFProps) {
  const rationaleSet = country === "cz" ? rationaleLabelsCZ : rationaleLabels;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.buildingName}>{bld.name}</Text>
          <Text style={styles.buildingAddress}>{bld.address}</Text>
          {bld.ico && <Text style={styles.buildingIco}>IČO: {bld.ico}</Text>}
        </View>

        {/* Title */}
        <Text style={styles.title}>ZÁPISNICA Z HLASOVANIA</Text>
        <Text style={styles.subtitle}>{voting.title}</Text>
        {entranceName && (
          <Text style={{ fontSize: 10, textAlign: "center" as const, marginBottom: 16, color: "#555" }}>
            Hlasovanie pre vchod: {entranceName}
          </Text>
        )}

        {/* Metadata */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Údaje o hlasovaní</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Typ hlasovania:</Text>
            <Text style={styles.metaValue}>
              {votingTypeLabels[voting.votingType] || voting.votingType}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Iniciátor:</Text>
            <Text style={styles.metaValue}>
              {initiatedByLabels[voting.initiatedBy] || voting.initiatedBy}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Počet bodov:</Text>
            <Text style={styles.metaValue}>{items.length}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Obdobie:</Text>
            <Text style={styles.metaValue}>
              {formatDate(voting.startsAt)} — {formatDate(voting.endsAt)}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vytvoril:</Text>
            <Text style={styles.metaValue}>
              {voting.createdBy?.name || "—"}
            </Text>
          </View>
        </View>

        {/* Per-item (resolution) sections — each with its own quorum,
            result, vote list and §14/§1187 co-owner breakdown. */}
        {items.map((item) => {
          const r = item.result;
          const multiOwner =
            r.unitBreakdowns?.filter((u) => u.hasMultipleOwners) ?? [];
          return (
            <View key={item.idx} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {`Bod ${item.idx + 1}: ${item.title}`}
              </Text>
              {item.description && (
                <Text style={{ fontSize: 9, color: "#555", marginBottom: 6 }}>
                  {item.description}
                </Text>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Typ kvóra:</Text>
                <Text style={styles.metaValue}>
                  {quorumTypeLabels[item.quorumType] || item.quorumType}
                </Text>
              </View>

              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>ZA</Text>
                <Text style={styles.resultValue}>{r.zaPercent.toFixed(1)}%</Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>PROTI</Text>
                <Text style={styles.resultValue}>{r.protiPercent.toFixed(1)}%</Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>ZDRŽAL SA</Text>
                <Text style={styles.resultValue}>{r.zdrzalSaPercent.toFixed(1)}%</Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Kvórum</Text>
                <Text style={styles.resultValue}>
                  {r.quorumReached ? "DOSIAHNUTÉ" : "NEDOSIAHNUTÉ"}
                </Text>
              </View>
              <Text
                style={[styles.passedBadge, r.passed ? styles.passed : styles.notPassed]}
              >
                {r.passed ? "SCHVÁLENÉ" : "NESCHVÁLENÉ"}
              </Text>

              {/* Per-item vote list */}
              {item.votes.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.colNum, styles.headerText]}>#</Text>
                    <Text style={[styles.colFlat, styles.headerText]}>{unitLabel}</Text>
                    <Text style={[styles.colOwner, styles.headerText]}>Vlastník</Text>
                    <Text style={[styles.colChoice, styles.headerText]}>Hlas</Text>
                    <Text style={[styles.colHash, styles.headerText]}>Audit hash</Text>
                  </View>
                  {item.votes.map((v, i) => (
                    <View key={i} style={styles.tableRow} wrap={false}>
                      <Text style={styles.colNum}>{i + 1}</Text>
                      <Text style={styles.colFlat}>{v.flatNumber}</Text>
                      <Text style={styles.colOwner}>{v.ownerName || "—"}</Text>
                      <Text style={styles.colChoice}>
                        {choiceLabels[v.choice] || v.choice}
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
                          <Text>Výsledok: {choiceLabelsResolution[u.resolved]}</Text>
                        </View>
                        {u.breakdown.map((b, i) => (
                          <View key={i} style={styles.unitBreakdownOwner}>
                            <Text>
                              {b.userName ?? "Spoluvlastník"} (podiel{" "}
                              {b.ownerShareNumerator}/{b.ownerShareDenominator})
                            </Text>
                            <Text>{choiceLabelsResolution[b.choice]}</Text>
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

        {/* Signatures — one signed ballot per owner-share (covers all items) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Odovzdané hlasovacie lístky (podpisy)</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.colNum, styles.headerText]}>#</Text>
            <Text style={[styles.colFlat, styles.headerText]}>{unitLabel}</Text>
            <Text style={[styles.colOwner, styles.headerText]}>Vlastník</Text>
            <Text style={[styles.colType, styles.headerText]}>Typ</Text>
            <Text style={[styles.colDate, styles.headerText]}>Dátum</Text>
            <Text style={[styles.colHash, styles.headerText]}>Ballot hash</Text>
          </View>
          {ballots.map((b, i) => (
            <View key={b.id} style={styles.tableRow} wrap={false}>
              <Text style={styles.colNum}>{i + 1}</Text>
              <Text style={styles.colFlat}>{b.flatNumber}</Text>
              <Text style={styles.colOwner}>{b.ownerName || "—"}</Text>
              <Text style={styles.colType}>
                {b.voteType === "paper" ? "Listinný" : "Elektronický"}
              </Text>
              <Text style={styles.colDate}>{formatDateTime(b.recordedAt)}</Text>
              <Text style={styles.colHash}>{b.ballotHash}</Text>
            </View>
          ))}
        </View>

        {/* Mandates */}
        {mandateRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Splnomocnenia</Text>
            {mandateRows.map((m) => (
              <View key={m.id} style={styles.mandateRow} wrap={false}>
                <Text style={styles.mandateText}>
                  {unitLabel} {m.fromFlatNumber} ({m.fromOwnerName}) → {m.toOwnerName}
                </Text>
              </View>
            ))}
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
              Vygenerované: {generatedAt}
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
