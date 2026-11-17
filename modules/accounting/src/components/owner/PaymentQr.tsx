import "server-only";

import QRCode from "qrcode";

// Payment QR (PAY by square for SK, QR Platba / SPAYD for CZ) rendered on
// the server from the payload getPredpisPdfData builds — same payload and
// QR options the predpis PDF uses (DownloadPredpisButton), so the code an
// owner scans here equals the one on the printed predpis.

export async function PaymentQr({ payload, alt }: { payload: string; alt: string }) {
  let dataUrl: string;
  try {
    dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 440,
    });
  } catch {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise
    <img
      src={dataUrl}
      alt={alt}
      width={220}
      height={220}
      className="h-[220px] w-[220px] rounded-lg border border-ui-border bg-white p-2"
    />
  );
}
