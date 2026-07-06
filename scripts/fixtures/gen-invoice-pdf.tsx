/**
 * Golden-fixture generator for AC 478 (invoice OCR / field extraction).
 * Renders a realistic SK supplier invoice (text layer) with a FIXED seed
 * and writes scripts/fixtures/invoice-sample.pdf.
 *
 * A supplier invoice is a THIRD-PARTY document (not one of the app's own
 * templates), so this fixture is a plausible stand-in — the point is to
 * pin the extractor to REAL pdf-parse text, not to any app component.
 *
 * Run ONCE to (re)generate:
 *   npx tsx --tsconfig scripts/tsconfig.e2e.json scripts/fixtures/gen-invoice-pdf.tsx
 *
 * The seed is the single source of truth the golden suite asserts.
 */
import "dotenv/config";
import React from "react";
import { writeFileSync } from "fs";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbGmT.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/roboto/v47/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf", fontWeight: 700 },
  ],
});

export const INVOICE_SEED = {
  supplier: "Výťahy Servis s.r.o.",
  ico: "36721530",
  dic: "SK2022334455",
  iban: "SK8975000000000012345671",
  ibanGrouped: "SK89 7500 0000 0000 1234 5671",
  vs: "2025014",
  invoiceNo: "2025014",
  nettoCents: 10000,
  dphCents: 2300,
  amountCents: 12300,
};

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 11, padding: 40, color: "#111" },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { color: "#555" },
  total: { marginTop: 16, fontSize: 13, fontWeight: 700 },
});

async function main() {
  const buf = await renderToBuffer(
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Faktúra č. {INVOICE_SEED.invoiceNo}</Text>
        <Text>{INVOICE_SEED.supplier}</Text>
        <Text>Kováčska 12, 040 01 Košice</Text>
        <View style={s.row}>
          <Text style={s.label}>IČO:</Text>
          <Text>{INVOICE_SEED.ico}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>IČ DPH:</Text>
          <Text>{INVOICE_SEED.dic}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Dátum vystavenia:</Text>
          <Text>03.04.2025</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>IBAN:</Text>
          <Text>{INVOICE_SEED.ibanGrouped}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Variabilný symbol:</Text>
          <Text>{INVOICE_SEED.vs}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Základ dane:</Text>
          <Text>100,00 €</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>DPH 23%:</Text>
          <Text>23,00 €</Text>
        </View>
        <Text style={s.total}>Celkom k úhrade: 123,00 €</Text>
      </Page>
    </Document>
  );
  const out = "scripts/fixtures/invoice-sample.pdf";
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
main().catch((e) => {
  console.error("invoice fixture generation failed:", e?.message ?? e);
  process.exit(2);
});
