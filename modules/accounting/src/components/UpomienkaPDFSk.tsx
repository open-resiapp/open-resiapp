import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Image,
} from "@react-pdf/renderer";

// Upomienka (dunning letter) PDF — SK TEMPLATE ONLY (BYT-20260512-002
// Phase 5). Statutory citations (§ 517 ods. 2 Občianskeho zákonníka,
// nariadenie vlády SR č. 87/1995 Z.z.) are part of this template's
// identity — never parametrize per country (project rule). The CZ
// upomínka (nař. vlády 351/2013 Sb.) is a separate Phase 6 component.
// Display labels arrive translated via props; legal text is hardcoded
// Slovak.
//
// ⚠️ Legal copy pending Filip's review before first real delivery.

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
  title: { fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 10, textAlign: "center", marginBottom: 16, color: "#555" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  metaLabel: { fontSize: 9, color: "#777" },
  metaValue: { fontSize: 12, fontWeight: 700 },
  intro: { fontSize: 10, marginBottom: 12, lineHeight: 1.5 },
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
  cItem: { flexBasis: "30%" },
  cDue: { flexBasis: "16%" },
  cNum: { flexBasis: "13.5%", textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    fontWeight: 700,
    fontSize: 11,
  },
  demand: {
    marginTop: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  qrImage: { width: 100, height: 100 },
  qrLine: { fontSize: 10, marginBottom: 3 },
  legal: { marginTop: 16, fontSize: 8, color: "#555", lineHeight: 1.5 },
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

export interface UpomienkaPDFSkProps {
  building: { name: string; address: string; ico: string | null };
  labels: {
    unit: string;
    vs: string;
    intro: string;
    item: string;
    due: string;
    days: string;
    open: string;
    rate: string;
    interest: string;
    total: string;
    demand: string;
    qrTitle: string;
    iban: string;
    footer: string;
  };
  asOf: string;
  unitLabel: string;
  vs: string | null;
  rows: {
    name: string;
    due: string;
    days: number;
    open: string;
    ratePct: number;
    interest: string;
  }[];
  totals: { open: string; interest: string; demand: string };
  iban: string | null;
  qrDataUrl: string | null;
}

export default function UpomienkaPDFSk(props: UpomienkaPDFSkProps) {
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

        {/* SK statutory identity — hardcoded by design. */}
        <Text style={styles.title}>
          Upomienka — výzva na úhradu nedoplatku
        </Text>
        <Text style={styles.subtitle}>ku dňu {props.asOf}</Text>

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

        <Text style={styles.intro}>{props.labels.intro}</Text>

        <View style={styles.tableHead}>
          <Text style={styles.cItem}>{props.labels.item}</Text>
          <Text style={styles.cDue}>{props.labels.due}</Text>
          <Text style={styles.cNum}>{props.labels.days}</Text>
          <Text style={styles.cNum}>{props.labels.open}</Text>
          <Text style={styles.cNum}>{props.labels.rate}</Text>
          <Text style={styles.cNum}>{props.labels.interest}</Text>
        </View>
        {props.rows.map((row, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={styles.cItem}>{row.name}</Text>
            <Text style={styles.cDue}>{row.due}</Text>
            <Text style={styles.cNum}>{row.days}</Text>
            <Text style={styles.cNum}>{row.open}</Text>
            <Text style={styles.cNum}>{row.ratePct} %</Text>
            <Text style={styles.cNum}>{row.interest}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.cItem}>{props.labels.total}</Text>
          <Text style={styles.cDue}></Text>
          <Text style={styles.cNum}></Text>
          <Text style={styles.cNum}>{props.totals.open}</Text>
          <Text style={styles.cNum}></Text>
          <Text style={styles.cNum}>{props.totals.interest}</Text>
        </View>

        <View style={styles.demand}>
          <Text style={{ fontSize: 12, fontWeight: 700 }}>
            {props.labels.demand}
          </Text>
          <Text style={{ fontSize: 14, fontWeight: 700 }}>
            {props.totals.demand}
          </Text>
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

        {/* SK zákonné poučenie — hardcoded by design. */}
        <Text style={styles.legal}>
          Úrok z omeškania je vypočítaný podľa § 517 ods. 2 Občianskeho
          zákonníka a nariadenia vlády SR č. 87/1995 Z.z. — základná sadzba
          Európskej centrálnej banky platná k prvému dňu omeškania zvýšená o
          päť percentuálnych bodov, jednoduchým denným úročením. Ak
          nedoplatok neuhradíte, spoločenstvo môže pohľadávku vymáhať súdnou
          cestou vrátane trov konania. Ak ste medzičasom uhradili, považujte
          túto upomienku za bezpredmetnú.
        </Text>

        <Text style={styles.footer}>{props.labels.footer}</Text>
      </Page>
    </Document>
  );
}
