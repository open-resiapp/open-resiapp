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

export interface VoteRowPDF {
  id: string;
  ownerName: string | null;
  flatNumber: string;
  choice: string;
  voteType: string;
  createdAt: string;
  auditHash: string;
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
  quorumType: QuorumType;
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
  results: VotingResults;
  votes: VoteRowPDF[];
  mandates: MandateRowPDF[];
  legalNotice: string | null;
  qrDataUrl: string | null;
  generatedAt: string;
}

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
  results,
  votes,
  mandates: mandateRows,
  legalNotice,
  qrDataUrl,
  generatedAt,
}: VotingMinutesPDFProps) {
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
            <Text style={styles.metaLabel}>Typ kvóra:</Text>
            <Text style={styles.metaValue}>
              {quorumTypeLabels[voting.quorumType as QuorumType] || voting.quorumType}
            </Text>
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

        {/* Results */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Výsledky</Text>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>ZA</Text>
            <Text style={styles.resultValue}>
              {results.zaPercent.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>PROTI</Text>
            <Text style={styles.resultValue}>
              {results.protiPercent.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>ZDRŽAL SA</Text>
            <Text style={styles.resultValue}>
              {results.zdrzalSaPercent.toFixed(1)}%
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Kvórum</Text>
            <Text style={styles.resultValue}>
              {results.quorumReached ? "DOSIAHNUTÉ" : "NEDOSIAHNUTÉ"}
            </Text>
          </View>

          <Text
            style={[
              styles.passedBadge,
              results.passed ? styles.passed : styles.notPassed,
            ]}
          >
            {results.passed ? "SCHVÁLENÉ" : "NESCHVÁLENÉ"}
          </Text>
        </View>

        {/* Vote table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zoznam hlasov</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.colNum, styles.headerText]}>#</Text>
            <Text style={[styles.colFlat, styles.headerText]}>Byt</Text>
            <Text style={[styles.colOwner, styles.headerText]}>Vlastník</Text>
            <Text style={[styles.colChoice, styles.headerText]}>Hlas</Text>
            <Text style={[styles.colType, styles.headerText]}>Typ</Text>
            <Text style={[styles.colDate, styles.headerText]}>Dátum</Text>
            <Text style={[styles.colHash, styles.headerText]}>Audit hash</Text>
          </View>
          {votes.map((v, i) => (
            <View key={v.id} style={styles.tableRow} wrap={false}>
              <Text style={styles.colNum}>{i + 1}</Text>
              <Text style={styles.colFlat}>{v.flatNumber}</Text>
              <Text style={styles.colOwner}>{v.ownerName || "—"}</Text>
              <Text style={styles.colChoice}>
                {choiceLabels[v.choice] || v.choice}
              </Text>
              <Text style={styles.colType}>
                {v.voteType === "paper" ? "Listinný" : "Elektronický"}
              </Text>
              <Text style={styles.colDate}>{formatDateTime(v.createdAt)}</Text>
              <Text style={styles.colHash}>{v.auditHash}</Text>
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
                  Byt {m.fromFlatNumber} ({m.fromOwnerName}) → {m.toOwnerName}
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
