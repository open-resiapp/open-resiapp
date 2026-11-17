"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { Button, Card, ConfirmDialog, LoadingBlock, PageHeader } from "@/components/ui";

interface ActiveToken {
  id: string;
  token: string;
  url: string;
  createdAt: string;
}

export default function RegistrationQrPage() {
  const { data: session } = useSession();
  const t = useTranslations("RegistrationQr");
  const tCommon = useTranslations("Common");
  const tOwners = useTranslations("Owners.board");

  const [active, setActive] = useState<ActiveToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<"rotate" | "disable" | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const canManage = hasPermission(role, "manageUsers");

  const fetchActive = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/registration-tokens");
    if (res.ok) {
      const body = await res.json();
      setActive(body.active);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (canManage) fetchActive();
  }, [canManage, fetchActive]);

  useEffect(() => {
    if (!active) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(active.url, { width: 320, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [active]);

  if (!canManage) {
    return (
      <div className="py-12 text-center text-lg text-ui-text-muted">
        {t("noPermission")}
      </div>
    );
  }

  async function handleGenerate() {
    setPendingConfirm(null);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/registration-tokens", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || tCommon("saveFailed"));
      setBusy(false);
      return;
    }
    setBusy(false);
    fetchActive();
  }

  async function handleDisable() {
    setPendingConfirm(null);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/registration-tokens", { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || tCommon("saveFailed"));
      setBusy(false);
      return;
    }
    setBusy(false);
    fetchActive();
  }

  function handlePrint() {
    if (!qrDataUrl || !active) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>${t("printTitle")}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 48px;
              text-align: center;
            }
            h1 { font-size: 28px; margin-bottom: 8px; }
            p { font-size: 16px; color: #4b5563; margin-bottom: 32px; }
            img { width: 320px; height: 320px; }
            .url { margin-top: 24px; font-size: 12px; color: #6b7280; word-break: break-all; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <h1>${t("printTitle")}</h1>
          <p>${t("printSubtitle")}</p>
          <img src="${qrDataUrl}" alt="QR" />
          <div class="url">${active.url}</div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  }

  return (
    <div className="max-w-4xl">
      {/* Reached from Vlastníci ("QR na registráciu pre celý dom"). */}
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        backHref="/owners"
        backLabel={tOwners("backToOwners")}
      />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-ui-danger px-4 py-3 text-base text-ui-danger"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingBlock />
      ) : !active ? (
        <Card as="section" padding="lg">
          <p className="mb-4 text-base text-ui-text">{t("noActive")}</p>
          <Button onClick={handleGenerate} loading={busy}>
            {busy ? tCommon("saving") : t("generate")}
          </Button>
        </Card>
      ) : (
        <Card as="section" padding="lg" className="space-y-6">
          <div className="flex flex-col items-start gap-6 sm:flex-row">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="QR"
                className="h-48 w-48 rounded border border-ui-border bg-white"
              />
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-base font-medium text-ui-text-muted">{t("urlLabel")}</p>
                <p className="break-all text-base text-ui-text">{active.url}</p>
              </div>
              <div>
                <p className="text-base font-medium text-ui-text-muted">{t("createdLabel")}</p>
                <p className="text-base text-ui-text">
                  {new Date(active.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-ui-border pt-4">
            <Button onClick={handlePrint} disabled={!qrDataUrl}>
              {t("print")}
            </Button>
            <Button variant="secondary" onClick={() => setPendingConfirm("rotate")} disabled={busy}>
              {t("rotate")}
            </Button>
            <Button variant="danger" onClick={() => setPendingConfirm("disable")} disabled={busy}>
              {t("disable")}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm === "disable" ? t("disable") : t("rotate")}
        description={pendingConfirm === "disable" ? t("confirmDisable") : t("confirmRotate")}
        confirmLabel={pendingConfirm === "disable" ? t("disable") : t("rotate")}
        cancelLabel={tCommon("cancel")}
        tone={pendingConfirm === "disable" ? "danger" : "default"}
        loading={busy}
        onConfirm={pendingConfirm === "disable" ? handleDisable : handleGenerate}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
