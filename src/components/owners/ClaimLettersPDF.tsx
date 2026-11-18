// One A4 page per owner: QR + short code + plain instructions, large type.
// Plain how-to copy, not statutory content. All text arrives pre-translated.
import { Document, Image, Page, StyleSheet, Text, View, Font } from "@react-pdf/renderer";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 16, padding: 48, color: "#111" },
  community: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  title: { fontSize: 26, fontWeight: 700, marginTop: 12, marginBottom: 6 },
  to: { fontSize: 20, marginBottom: 18 },
  step: { fontSize: 17, marginBottom: 8, lineHeight: 1.4 },
  qrBox: { alignItems: "center", marginTop: 14, marginBottom: 10 },
  qr: { width: 220, height: 220 },
  codeLabel: { fontSize: 16, marginTop: 4 },
  code: { fontSize: 32, fontWeight: 700, letterSpacing: 3, marginTop: 4 },
  valid: { fontSize: 16, marginTop: 10 },
  help: { fontSize: 16, marginTop: 22, lineHeight: 1.4 },
});

export interface ClaimLetterLabels {
  title: string;
  codeLabel: string;
  help: string;
}

export interface ClaimLetterPage {
  toLine: string;
  qrDataUrl: string;
  shortCodeDisplay: string;
  validLine: string;
  stepsLines: string[];
}

export default function ClaimLettersPDF({
  communityName,
  labels,
  pages,
}: {
  communityName: string;
  labels: ClaimLetterLabels;
  pages: ClaimLetterPage[];
}) {
  return (
    <Document>
      {pages.map((p, i) => (
        <Page key={i} size="A4" style={s.page}>
          <Text style={s.community}>{communityName}</Text>
          <Text style={s.title}>{labels.title}</Text>
          <Text style={s.to}>{p.toLine}</Text>
          {p.stepsLines.map((line, j) => (
            <Text key={j} style={s.step}>
              {line}
            </Text>
          ))}
          <View style={s.qrBox}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={p.qrDataUrl} style={s.qr} />
            <Text style={s.codeLabel}>{labels.codeLabel}</Text>
            <Text style={s.code}>{p.shortCodeDisplay}</Text>
          </View>
          <Text style={s.valid}>{p.validLine}</Text>
          <Text style={s.help}>{labels.help}</Text>
        </Page>
      ))}
    </Document>
  );
}
