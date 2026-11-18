import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// 2026-11-18 — printable invitation to an owners' meeting (schôdza
// vlastníkov). One page per addressee (bulk print for owners without e-mail)
// or one generic page without an addressee. Display labels arrive
// pre-translated (`labels`, MeetingAttendance.invitationPdf.*); the statutory
// paragraphs live in INVITATION_LEGAL_COPY_SK below and are printed ONLY when
// the caller passes `statutory` (SK HOA template — CLAUDE.md: legally
// regulated content is never parametrized across templates / countries).

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

// ──────────────────────────────────────────────────────────────────────────
// INVITATION_LEGAL_COPY_SK — statutory wording, zák. 182/1993 Z.z. In one
// place so the template-aware legal-copy module (src/lib/legal-copy, in
// progress) can swap it later.
// TODO(legal-copy sign-off): wording NOT signed off yet.
//  - § 14a ods. 2: termín, miesto a program schôdze oznámené najneskôr 7 dní
//    vopred, v listinnej podobe každému vlastníkovi (ak zmluva neurčí inak).
//  - § 14 ods. 4: zastúpenie len na základe listinného plnomocenstva
//    s úradne osvedčeným podpisom, preukazuje sa originálom na začiatku schôdze.
// ──────────────────────────────────────────────────────────────────────────
export const INVITATION_LEGAL_COPY_SK = {
  title: "POZVÁNKA NA SCHÔDZU VLASTNÍKOV BYTOV A NEBYTOVÝCH PRIESTOROV",
  legalBasis:
    "Oznámenie o schôdzi vlastníkov podľa § 14a ods. 2 zákona č. 182/1993 Z.z. o vlastníctve bytov a nebytových priestorov.",
  proxyNotice:
    "Vlastník bytu alebo nebytového priestoru sa môže dať na schôdzi zastúpiť inou osobou na základe plnomocenstva v listinnej podobe s úradne osvedčeným podpisom (§ 14 ods. 4 zákona č. 182/1993 Z.z.). Splnomocnená osoba sa preukazuje originálom plnomocenstva na začiatku schôdze.",
} as const;

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 11, padding: 40, color: "#1a1a1a" },
  community: { fontSize: 13, fontWeight: 700, textAlign: "center", marginBottom: 2 },
  muted: { fontSize: 10, color: "#555", textAlign: "center" },
  title: { fontSize: 15, fontWeight: 700, textAlign: "center", marginTop: 16, marginBottom: 14 },
  addressee: { marginBottom: 14, padding: 8, borderWidth: 0.75, borderColor: "#999" },
  addresseeName: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  section: { marginBottom: 12 },
  h: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 140, color: "#555" },
  value: { flex: 1, fontWeight: 700 },
  item: { marginBottom: 6 },
  itemTitle: { fontWeight: 700 },
  itemDesc: { fontSize: 10, color: "#333" },
  paragraph: { fontSize: 10, marginBottom: 6, lineHeight: 1.4 },
  footer: { marginTop: 16, fontSize: 10, color: "#555" },
  signature: { marginTop: 28, flexDirection: "row", justifyContent: "flex-end" },
  signatureBox: { width: 200, borderTopWidth: 0.75, borderTopColor: "#333", paddingTop: 3, fontSize: 10, textAlign: "center" },
});

export interface InvitationLabels {
  title: string; // non-statutory fallback title
  addressee: string;
  units: string;
  share: string;
  when: string;
  place: string;
  agenda: string;
  rsvpHint: string;
  convenedBy: string;
  issuedOn: string;
  icoLabel: string;
}

export interface InvitationData {
  community: { name: string; address: string; ico: string | null };
  when: string; // pre-formatted date + time
  place: string;
  convenedBy: string;
  issuedOn: string; // pre-formatted
  agenda: { idx: number; title: string; description: string | null }[];
}

export interface InvitationAddressee {
  name: string;
  units: string;
  /** Pre-formatted share, e.g. "2,35 %". */
  share: string;
}

function InvitationPage({
  data,
  labels,
  addressee,
  statutory,
}: {
  data: InvitationData;
  labels: InvitationLabels;
  addressee: InvitationAddressee | null;
  statutory: boolean;
}) {
  return (
    <Page size="A4" style={s.page}>
      <Text style={s.community}>{data.community.name}</Text>
      <Text style={s.muted}>{data.community.address}</Text>
      {data.community.ico ? (
        <Text style={s.muted}>
          {labels.icoLabel}: {data.community.ico}
        </Text>
      ) : null}
      <Text style={s.title}>{statutory ? INVITATION_LEGAL_COPY_SK.title : labels.title}</Text>

      {addressee ? (
        <View style={s.addressee}>
          <Text style={{ fontSize: 9, color: "#555" }}>{labels.addressee}</Text>
          <Text style={s.addresseeName}>{addressee.name}</Text>
          <Text>
            {labels.units}: {addressee.units}
          </Text>
          <Text>
            {labels.share}: {addressee.share}
          </Text>
        </View>
      ) : null}

      <View style={s.section}>
        <View style={s.row}>
          <Text style={s.label}>{labels.when}</Text>
          <Text style={s.value}>{data.when}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>{labels.place}</Text>
          <Text style={s.value}>{data.place}</Text>
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.h}>{labels.agenda}</Text>
        {data.agenda.map((it) => (
          <View key={it.idx} style={s.item} wrap={false}>
            <Text style={s.itemTitle}>
              {it.idx + 1}. {it.title}
            </Text>
            {it.description ? <Text style={s.itemDesc}>{it.description}</Text> : null}
          </View>
        ))}
      </View>

      {statutory ? <Text style={s.paragraph}>{INVITATION_LEGAL_COPY_SK.proxyNotice}</Text> : null}
      <Text style={s.paragraph}>{labels.rsvpHint}</Text>

      <View style={s.signature}>
        <Text style={s.signatureBox}>
          {labels.convenedBy}: {data.convenedBy}
        </Text>
      </View>

      <Text style={s.footer}>
        {labels.issuedOn}: {data.issuedOn}
      </Text>
      {statutory ? <Text style={s.footer}>{INVITATION_LEGAL_COPY_SK.legalBasis}</Text> : null}
    </Page>
  );
}

export default function InvitationPDF({
  data,
  labels,
  addressees,
  statutory,
}: {
  data: InvitationData;
  labels: InvitationLabels;
  /** One page each; empty = one generic page without an addressee. */
  addressees: InvitationAddressee[];
  statutory: boolean;
}) {
  return (
    <Document>
      {addressees.length === 0 ? (
        <InvitationPage data={data} labels={labels} addressee={null} statutory={statutory} />
      ) : (
        addressees.map((a, i) => (
          <InvitationPage key={i} data={data} labels={labels} addressee={a} statutory={statutory} />
        ))
      )}
    </Document>
  );
}
