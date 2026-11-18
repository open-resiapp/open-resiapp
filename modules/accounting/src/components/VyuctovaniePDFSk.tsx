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
//
// Two layouts (fix 2026-11-18):
//   basis "prescribed" — result = náklady − PREDPÍSANÉ zálohy (what the
//     ledger books); unpaid advances are a separate "z toho neuhradené"
//     column + box, NOT part of the result.
//   basis "paid" (default) — the legacy layout (rozdiel vs uhradené
//     zálohy), kept so already-delivered statements re-render unchanged.
// Both keep the shape vyuctovanie-pdf-import.ts parses: data rows carry ≥4
// amounts ending with the result, the total row exactly 3, and the LAST
// single-amount line is the result box (the arrears box sits before it).

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 11, padding: 40, color: "#1a1a1a" },
  header: { marginBottom: 16, textAlign: "center" },
  buildingName: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  buildingAddress: { fontSize: 11, color: "#444", marginBottom: 2 },
  buildingIco: { fontSize: 10, color: "#444" },
  title: { fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 2 },
  subtitle: { fontSize: 11, textAlign: "center", marginBottom: 4, color: "#333" },
  legal: { fontSize: 10, textAlign: "center", color: "#444", marginBottom: 16 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  metaLabel: { fontSize: 10, color: "#444" },
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
  arrearsBox: {
    marginTop: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
  },
  arrearsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  arrearsLabel: { fontSize: 11, fontWeight: 700 },
  arrearsValue: { fontSize: 11, fontWeight: 700 },
  arrearsNote: { fontSize: 10, color: "#444", marginTop: 4, lineHeight: 1.4 },
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
  qrLine: { fontSize: 11, marginBottom: 3 },
  reklamacia: { marginTop: 16, fontSize: 10, color: "#333", lineHeight: 1.5 },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 10,
    color: "#555",
    textAlign: "center",
  },
});

export interface VyuctovaniePDFSkProps {
  building: { name: string; address: string; ico: string | null; dic?: string | null };
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
    /** basis "prescribed" only. */
    prescribedAdvances?: string;
    unpaid?: string;
    result?: string;
    arrearsTitle?: string;
    arrearsNote?: string;
  };
  /** Statement basis — see file header. Default "paid" (legacy layout). */
  basis?: "prescribed" | "paid";
  year: number;
  unitLabel: string;
  vs: string | null;
  rows: {
    name: string;
    prescribed: string;
    advances: string;
    cost: string;
    difference: string;
    /** basis "prescribed": prescribed − paid. */
    unpaid?: string;
  }[];
  totals: {
    advances: string;
    cost: string;
    difference: string;
    prescribed?: string;
    unpaid?: string;
  };
  totalDifferenceCents: number;
  iban: string | null;
  qrDataUrl: string | null;
}

export default function VyuctovaniePDFSk(props: VyuctovaniePDFSkProps) {
  const owes = props.totalDifferenceCents > 0;
  const overpaid = props.totalDifferenceCents < 0;
  const prescribedBasis = props.basis === "prescribed";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.buildingName}>{props.building.name}</Text>
          <Text style={styles.buildingAddress}>{props.building.address}</Text>
          {props.building.ico && (
            <Text style={styles.buildingIco}>IČO: {props.building.ico}</Text>
          )}
          {props.building.dic && (
            <Text style={styles.buildingIco}>DIČ: {props.building.dic}</Text>
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

        {prescribedBasis ? (
          <>
            <View style={styles.tableHead}>
              <Text style={styles.cService}>{props.labels.service}</Text>
              <Text style={styles.cNum}>{props.labels.cost}</Text>
              <Text style={styles.cNum}>
                {props.labels.prescribedAdvances ?? props.labels.prescribed}
              </Text>
              <Text style={styles.cNum}>{props.labels.unpaid ?? ""}</Text>
              <Text style={styles.cNum}>
                {props.labels.result ?? props.labels.difference}
              </Text>
            </View>
            {props.rows.map((row, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.cService}>{row.name}</Text>
                <Text style={styles.cNum}>{row.cost}</Text>
                <Text style={styles.cNum}>{row.prescribed}</Text>
                <Text style={styles.cNum}>{row.unpaid ?? ""}</Text>
                <Text style={styles.cNum}>{row.difference}</Text>
              </View>
            ))}
            {/* Exactly three amounts — the unpaid total lives in the
                arrears box below (parser contract, see header). */}
            <View style={styles.totalRow}>
              <Text style={styles.cService}>{props.labels.total}</Text>
              <Text style={styles.cNum}>{props.totals.cost}</Text>
              <Text style={styles.cNum}>{props.totals.prescribed ?? ""}</Text>
              <Text style={styles.cNum}></Text>
              <Text style={styles.cNum}>{props.totals.difference}</Text>
            </View>

            <View style={styles.arrearsBox}>
              <View style={styles.arrearsRow}>
                <Text style={styles.arrearsLabel}>
                  {props.labels.arrearsTitle ?? ""}
                </Text>
                <Text style={styles.arrearsValue}>{props.totals.unpaid ?? ""}</Text>
              </View>
              {props.labels.arrearsNote && (
                <Text style={styles.arrearsNote}>{props.labels.arrearsNote}</Text>
              )}
            </View>
          </>
        ) : (
          <>
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
          </>
        )}

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
          predsedu spoločenstva. Nedoplatok je splatný a preplatok bude
          vrátený v lehote podľa zmluvy o spoločenstve, spravidla do 30 dní
          od doručenia vyúčtovania.
        </Text>

        <Text style={styles.footer}>{props.labels.footer}</Text>
      </Page>
    </Document>
  );
}
