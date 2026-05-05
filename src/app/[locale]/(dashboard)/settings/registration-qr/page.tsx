"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

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

  const [active, setActive] = useState<ActiveToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="text-center py-12 text-gray-500 text-lg">
        {t("noPermission")}
      </div>
    );
  }

  async function handleGenerate(rotate: boolean) {
    if (rotate && !confirm(t("confirmRotate"))) return;
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
    if (!confirm(t("confirmDisable"))) return;
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
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("title")}</h1>
      <p className="text-base text-gray-500 mb-6">{t("subtitle")}</p>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
          <div className="h-40 bg-gray-200 rounded" />
        </div>
      ) : !active ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-base text-gray-700 mb-4">{t("noActive")}</p>
          <button
            onClick={() => handleGenerate(false)}
            disabled={busy}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
          >
            {busy ? tCommon("saving") : t("generate")}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="QR"
                className="w-48 h-48 rounded border border-gray-200"
              />
            )}
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-500">
                  {t("urlLabel")}
                </p>
                <p className="text-base text-gray-900 break-all">
                  {active.url}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">
                  {t("createdLabel")}
                </p>
                <p className="text-base text-gray-700">
                  {new Date(active.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-gray-200 pt-4">
            <button
              onClick={handlePrint}
              disabled={!qrDataUrl}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
            >
              {t("print")}
            </button>
            <button
              onClick={() => handleGenerate(true)}
              disabled={busy}
              className="px-5 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-base font-medium rounded-lg transition-colors"
            >
              {busy ? tCommon("saving") : t("rotate")}
            </button>
            <button
              onClick={handleDisable}
              disabled={busy}
              className="px-5 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-base font-medium rounded-lg transition-colors"
            >
              {t("disable")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
