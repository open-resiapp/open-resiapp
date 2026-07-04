import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
} from "@react-pdf/renderer";

// Monthly predpis PDF (BYT-20260512-002 Phase 1) — mirrors the
// VotingMinutesPDF structure. All display strings arrive translated via
// props (the component renders in the client where next-intl lives).
// The predpis is a payment schedule, NOT a fiscal invoice — no invoice
// number, no VAT fields (domain edge case 8).

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
  header: { marginBottom: 20, textAlign: "center" },
  buildingName: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  buildingAddress: { fontSize: 10, color: "#555", marginBottom: 2 },
  buildingIco: { fontSize: 9, color: "#777" },
  title: { fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 12, textAlign: "center", marginBottom: 20, color: "#333" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  metaLabel: { fontSize: 9, color: "#777" },
  metaValue: { fontSize: 12, fontWeight: 700 },
  table: { marginBottom: 16 },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 4,
  },
  tableHeader: { fontWeight: 700, borderBottomColor: "#999" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    fontWeight: 700,
    fontSize: 12,
  },
  qrSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
  },
  qrImage: { width: 110, height: 110 },
  qrDetails: { flex: 1 },
  qrTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  qrLine: { fontSize: 10, marginBottom: 3 },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#999",
    textAlign: "center",
  },
});

export interface PredpisPDFProps {
  building: { name: string; address: string; ico: string | null };
  labels: {
    title: string;
    subtitle: string;
    unit: string;
    vs: string;
    service: string;
    monthlyAmount: string;
    total: string;
    qrTitle: string;
    iban: string;
    footer: string;
  };
  unitLabel: string;
  vs: string;
  rows: { name: string; amount: string }[];
  total: string;
  iban: string;
  /** PNG data URL — pre-rendered PAY by square QR; null hides the block. */
  qrDataUrl: string | null;
}

export default function PredpisPDF(props: PredpisPDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.buildingName}>{props.building.name}</Text>
          <Text style={styles.buildingAddress}>{props.building.address}</Text>
          {props.building.ico && (
            <Text style={styles.buildingIco}>IČO: {props.building.ico}</Text>
          )}
        </View>

        <Text style={styles.title}>{props.labels.title}</Text>
        <Text style={styles.subtitle}>{props.labels.subtitle}</Text>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>{props.labels.unit}</Text>
            <Text style={styles.metaValue}>{props.unitLabel}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>{props.labels.vs}</Text>
            <Text style={styles.metaValue}>{props.vs}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text>{props.labels.service}</Text>
            <Text>{props.labels.monthlyAmount}</Text>
          </View>
          {props.rows.map((row, i) => (
            <View key={i} style={styles.tableRow}>
              <Text>{row.name}</Text>
              <Text>{row.amount}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text>{props.labels.total}</Text>
            <Text>{props.total}</Text>
          </View>
        </View>

        <View style={styles.qrSection}>
          {props.qrDataUrl && (
            /* eslint-disable-next-line jsx-a11y/alt-text */
            <Image style={styles.qrImage} src={props.qrDataUrl} />
          )}
          <View style={styles.qrDetails}>
            <Text style={styles.qrTitle}>{props.labels.qrTitle}</Text>
            <Text style={styles.qrLine}>
              {props.labels.iban}: {props.iban}
            </Text>
            <Text style={styles.qrLine}>
              {props.labels.vs}: {props.vs}
            </Text>
            <Text style={styles.qrLine}>
              {props.labels.total}: {props.total}
            </Text>
          </View>
        </View>

        <Text style={styles.footer}>{props.labels.footer}</Text>
      </Page>
    </Document>
  );
}
