// BYT-20261118-002 §4 — "Oznámenie o písomnom hlasovaní" (§14a ods. 2
// zák. 182/1993 Z.z.). SK HOA template ONLY — legally regulated content,
// never parametrized across templates / countries (CLAUDE.md UI patterns).
// All copy arrives pre-translated in `labels` (VotingWorkflow.notice.*).
// TODO(legal-signoff): wording of the announcement (spec Decisions 3) must be
// reviewed before this document ships to production communities.
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 10, padding: 40, color: "#1a1a1a" },
  center: { textAlign: "center" },
  community: { fontSize: 13, fontWeight: 700, textAlign: "center", marginBottom: 2 },
  muted: { fontSize: 9, color: "#555", textAlign: "center" },
  title: { fontSize: 16, fontWeight: 700, textAlign: "center", marginTop: 16, marginBottom: 12 },
  section: { marginBottom: 12 },
  h: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 140, color: "#555" },
  value: { flex: 1 },
  item: { marginBottom: 8 },
  itemTitle: { fontWeight: 700 },
  footer: { marginTop: 24, fontSize: 9, color: "#555" },
});

export interface NoticeLabels {
  title: string;
  announcedBy: string;
  term: string;
  place: string;
  questions: string;
  electronic: string;
  electronicText: string;
  verifiers: string;
  announcedOn: string;
  icoLabel: string;
  legalBasis: string;
}

export interface NoticeData {
  community: { name: string; address: string; ico: string | null };
  announcedBy: string;
  term: string; // pre-formatted "from – to"
  place: string;
  announcedOn: string; // pre-formatted date
  verifiers: string[];
  electronicAllowed: boolean;
  items: { idx: number; title: string; description: string | null }[];
}

export default function VotingNoticePDF({ data, labels }: { data: NoticeData; labels: NoticeLabels }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.community}>{data.community.name}</Text>
        <Text style={s.muted}>{data.community.address}</Text>
        {data.community.ico && (
          <Text style={s.muted}>
            {labels.icoLabel}: {data.community.ico}
          </Text>
        )}
        <Text style={s.title}>{labels.title}</Text>

        <View style={s.section}>
          <View style={s.row}>
            <Text style={s.label}>{labels.announcedBy}</Text>
            <Text style={s.value}>{data.announcedBy}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>{labels.term}</Text>
            <Text style={s.value}>{data.term}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>{labels.place}</Text>
            <Text style={s.value}>{data.place}</Text>
          </View>
          {data.verifiers.length > 0 && (
            <View style={s.row}>
              <Text style={s.label}>{labels.verifiers}</Text>
              <Text style={s.value}>{data.verifiers.join(", ")}</Text>
            </View>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.h}>{labels.questions}</Text>
          {data.items.map((it) => (
            <View key={it.idx} style={s.item} wrap={false}>
              <Text style={s.itemTitle}>
                {it.idx + 1}. {it.title}
              </Text>
              {it.description ? <Text>{it.description}</Text> : null}
            </View>
          ))}
        </View>

        {data.electronicAllowed && (
          <View style={s.section}>
            <Text style={s.h}>{labels.electronic}</Text>
            <Text>{labels.electronicText}</Text>
          </View>
        )}

        <Text style={s.footer}>
          {labels.announcedOn}: {data.announcedOn}
        </Text>
        <Text style={s.footer}>{labels.legalBasis}</Text>
      </Page>
    </Document>
  );
}
