// BYT-20261118-002 §4 — "Hlasovacia listina" (§14a ods. 4 zák. 182/1993
// Z.z.): full text, numbered questions, voting term, owner name, ZA / PROTI /
// ZDRŽAL SA per question, date + signature, two verifier signature lines.
// One page per owner (an owner with several units: one page listing all of
// them); `owners = [null]` renders the blank sheet with no owner/unit/share.
// SK HOA template ONLY — legally regulated content.
// TODO(legal-signoff): wording + "one sheet per owner" (spec Decisions 3).
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 10, padding: 36, color: "#1a1a1a" },
  community: { fontSize: 11, fontWeight: 700, textAlign: "center" },
  title: { fontSize: 15, fontWeight: 700, textAlign: "center", marginTop: 10, marginBottom: 4 },
  votingTitle: { fontSize: 11, textAlign: "center", marginBottom: 10 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 130, color: "#555" },
  value: { flex: 1, borderBottom: "0.5pt solid #999", minHeight: 12 },
  item: { marginTop: 8, paddingTop: 6, borderTop: "0.5pt solid #ccc" },
  itemTitle: { fontWeight: 700, marginBottom: 2 },
  boxes: { flexDirection: "row", marginTop: 4 },
  box: { flexDirection: "row", alignItems: "center", marginRight: 18 },
  square: { width: 11, height: 11, border: "1pt solid #333", marginRight: 4 },
  sign: { marginTop: 22, flexDirection: "row", justifyContent: "space-between" },
  signCol: { width: "45%" },
  signLine: { borderTop: "0.5pt solid #333", marginTop: 24, paddingTop: 2, fontSize: 9, color: "#555" },
  note: { marginTop: 10, fontSize: 8, color: "#555" },
});

export interface BallotLabels {
  title: string;
  term: string;
  owner: string;
  units: string;
  for: string;
  against: string;
  abstain: string;
  dateAndSignature: string;
  verifier: string;
  unmarkedNote: string;
}

export interface BallotOwnerPage {
  ownerName: string;
  /** e.g. "Byt 12 (podiel 1/2)" — pre-formatted. */
  units: string[];
}

export interface BallotData {
  communityName: string;
  votingTitle: string;
  term: string;
  items: { idx: number; title: string; description: string | null }[];
  verifiers: string[];
}

export default function VotingBallotPDF({
  data,
  owners,
  labels,
}: {
  data: BallotData;
  /** One entry per page; null = blank ballot sheet. */
  owners: (BallotOwnerPage | null)[];
  labels: BallotLabels;
}) {
  const verifierLines = [0, 1].map((i) => data.verifiers[i] ?? "");
  return (
    <Document>
      {owners.map((o, pageIdx) => (
        <Page key={pageIdx} size="A4" style={s.page}>
          <Text style={s.community}>{data.communityName}</Text>
          <Text style={s.title}>{labels.title}</Text>
          <Text style={s.votingTitle}>{data.votingTitle}</Text>
          <View style={s.row}>
            <Text style={s.label}>{labels.term}</Text>
            <Text style={s.value}>{data.term}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>{labels.owner}</Text>
            <Text style={s.value}>{o?.ownerName ?? ""}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>{labels.units}</Text>
            <Text style={s.value}>{o ? o.units.join(", ") : ""}</Text>
          </View>

          {data.items.map((it) => (
            <View key={it.idx} style={s.item} wrap={false}>
              <Text style={s.itemTitle}>
                {it.idx + 1}. {it.title}
              </Text>
              {it.description ? <Text>{it.description}</Text> : null}
              <View style={s.boxes}>
                {[labels.for, labels.against, labels.abstain].map((l) => (
                  <View key={l} style={s.box}>
                    <View style={s.square} />
                    <Text>{l}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}

          <View style={s.sign} wrap={false}>
            <View style={s.signCol}>
              <Text style={s.signLine}>{labels.dateAndSignature}</Text>
            </View>
          </View>
          <View style={s.sign} wrap={false}>
            {verifierLines.map((name, i) => (
              <View key={i} style={s.signCol}>
                <Text style={s.signLine}>
                  {labels.verifier}
                  {name ? `: ${name}` : ""}
                </Text>
              </View>
            ))}
          </View>
          <Text style={s.note}>{labels.unmarkedNote}</Text>
        </Page>
      ))}
    </Document>
  );
}
