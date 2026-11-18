import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// BYT-20261118-001 §7 — PDF renderer of the attendance export. Renders the
// rows built by the server (buildAttendanceExport, via
// /api/votings/[id]/attendance/export?format=json) — the xlsx renderer uses
// the very same rows. Labels arrive pre-translated. Carries NO statutory
// citation (legal content rule; the signed ORIGINAL is the §14a ods. 8
// attachment, this is only the printable sheet).

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 10, padding: 32, color: "#1a1a1a" },
  community: { fontSize: 11, textAlign: "center", marginBottom: 4 },
  title: { fontSize: 15, fontWeight: 700, textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 11, textAlign: "center", marginBottom: 16, color: "#333" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#999", minHeight: 24, alignItems: "center" },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#000", paddingBottom: 4, fontWeight: 700 },
  cell: { paddingHorizontal: 3 },
  footer: { marginTop: 12, fontSize: 10 },
});

export interface AttendancePdfColumn {
  key: string;
  label: string;
  /** flex weight */
  width: number;
}

export default function AttendancePDF({
  community,
  title,
  subtitle,
  columns,
  rows,
  footer,
}: {
  community: string;
  title: string;
  subtitle: string;
  columns: AttendancePdfColumn[];
  rows: Record<string, string>[];
  footer: string;
}) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {community ? <Text style={styles.community}>{community}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.head} fixed>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.cell, { flex: c.width }]}>
              {c.label}
            </Text>
          ))}
        </View>
        {rows.map((r, i) => (
          <View key={i} style={styles.row} wrap={false}>
            {columns.map((c) => (
              <Text key={c.key} style={[styles.cell, { flex: c.width }]}>
                {r[c.key] ?? ""}
              </Text>
            ))}
          </View>
        ))}
        <Text style={styles.footer}>{footer}</Text>
      </Page>
    </Document>
  );
}
