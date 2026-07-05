import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
} from "@react-pdf/renderer";

// Ročné vyúčtovanie PDF — SK TEMPLATE ONLY (BYT-20260512-002 Phase 4).
// Statutory citations below reference zák. č. 182/1993 Z.z. and are part
// of this template's identity — NEVER parametrize them per country or
// community kind (project rule on legally regulated content). The CZ
// template (zák. 67/2013 Sb.) is a separate component in Phase 6.
// Display labels (column headers) arrive translated via props; the legal
// text is intentionally hardcoded Slovak.
//
// ⚠️ Legal copy pending Filip's review before first real delivery
// (WORK_LOG note) — the citation references come from the spec.

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 10, padding: 40, color: "#1a1a1a" },
  header: { marginBottom: 16, textAlign: "center" },
  buildingName: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  buildingAddress: { fontSize: 10, color: "#555", marginBottom: 2 },
  buildingIco: { fontSize: 9, color: "#777" },
  title: { fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 2 },
  subtitle: { fontSize: 11, textAlign: "center", marginBottom: 4, color: "#333" },
  legal: { fontSize: 8, textAlign: "center", color: "#777", marginBottom: 16 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  metaLabel: { fontSize: 9, color: "#777" },
  metaValue: { fontSize: 12, fontWeight: 700 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#999",
    paddingVertical: 4,
    fontWeight: 700,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 4,
  },
  cService: { flexBasis: "32%" },
  cNum: { flexBasis: "17%", textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    fontWeight: 700,
    fontSize: 11,
  },
  resultBox: {
    marginTop: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultLabel: { fontSize: 12, fontWeight: 700 },
  resultValue: { fontSize: 14, fontWeight: 700 },
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
  qrImage: { width: 100, height: 100 },
  qrLine: { fontSize: 10, marginBottom: 3 },
  reklamacia: { marginTop: 16, fontSize: 8, color: "#555", lineHeight: 1.5 },
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

export interface VyuctovaniePDFSkProps {
  building: { name: string; address: string; ico: string | null };
  labels: {
    unit: string;
    vs: string;
    service: string;
    prescribed: string;
    advances: string;
    cost: string;
    difference: string;
    total: string;
    nedoplatok: string;
    preplatok: string;
    settled: string;
    qrTitle: string;
    iban: string;
    footer: string;
  };
  year: number;
  unitLabel: string;
  vs: string | null;
  rows: {
    name: string;
    prescribed: string;
    advances: string;
    cost: string;
    difference: string;
  }[];
  totals: { advances: string; cost: string; difference: string };
  totalDifferenceCents: number;
  iban: string | null;
  qrDataUrl: string | null;
}

export default function VyuctovaniePDFSk(props: VyuctovaniePDFSkProps) {
  const owes = props.totalDifferenceCents > 0;
  const overpaid = props.totalDifferenceCents < 0;
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

        {/* SK statutory identity — hardcoded by design (template-aware). */}
        <Text style={styles.title}>
          Vyúčtovanie záloh na plnenia za rok {props.year}
        </Text>
        <Text style={styles.subtitle}>
          Vyúčtovanie úhrad za plnenia spojené s užívaním bytu
        </Text>
        <Text style={styles.legal}>
          podľa § 7b ods. 3 zákona č. 182/1993 Z.z. o vlastníctve bytov a
          nebytových priestorov v znení neskorších predpisov
        </Text>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>{props.labels.unit}</Text>
            <Text style={styles.metaValue}>{props.unitLabel}</Text>
          </View>
          {props.vs && (
            <View>
              <Text style={styles.metaLabel}>{props.labels.vs}</Text>
              <Text style={styles.metaValue}>{props.vs}</Text>
            </View>
          )}
        </View>

        <View style={styles.tableHead}>
          <Text style={styles.cService}>{props.labels.service}</Text>
          <Text style={styles.cNum}>{props.labels.prescribed}</Text>
          <Text style={styles.cNum}>{props.labels.advances}</Text>
          <Text style={styles.cNum}>{props.labels.cost}</Text>
          <Text style={styles.cNum}>{props.labels.difference}</Text>
        </View>
        {props.rows.map((row, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={styles.cService}>{row.name}</Text>
            <Text style={styles.cNum}>{row.prescribed}</Text>
            <Text style={styles.cNum}>{row.advances}</Text>
            <Text style={styles.cNum}>{row.cost}</Text>
            <Text style={styles.cNum}>{row.difference}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.cService}>{props.labels.total}</Text>
          <Text style={styles.cNum}></Text>
          <Text style={styles.cNum}>{props.totals.advances}</Text>
          <Text style={styles.cNum}>{props.totals.cost}</Text>
          <Text style={styles.cNum}>{props.totals.difference}</Text>
        </View>

        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>
            {owes
              ? props.labels.nedoplatok
              : overpaid
                ? props.labels.preplatok
                : props.labels.settled}
          </Text>
          <Text style={styles.resultValue}>{props.totals.difference}</Text>
        </View>

        {props.qrDataUrl && props.iban && (
          <View style={styles.qrSection}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.qrImage} src={props.qrDataUrl} />
            <View>
              <Text style={[styles.qrLine, { fontWeight: 700 }]}>
                {props.labels.qrTitle}
              </Text>
              <Text style={styles.qrLine}>
                {props.labels.iban}: {props.iban}
              </Text>
              {props.vs && (
                <Text style={styles.qrLine}>
                  {props.labels.vs}: {props.vs}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* SK statutory poučenie — hardcoded by design. */}
        <Text style={styles.reklamacia}>
          Prípadné námietky proti tomuto vyúčtovaniu uplatnite písomne u
          predsedu spoločenstva bez zbytočného odkladu. Nedoplatok je
          splatný do 30 dní od doručenia vyúčtovania, ak zmluva o
          spoločenstve neurčuje inak; preplatok bude vrátený v rovnakej
          lehote.
        </Text>

        <Text style={styles.footer}>{props.labels.footer}</Text>
      </Page>
    </Document>
  );
}
