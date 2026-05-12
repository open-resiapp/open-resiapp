"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";

interface ShellClaimDialogProps {
  shellId: string;
  shellName: string;
  existingEmail: string | null;
  mode: "email" | "qr";
  locale: string;
  onClose: () => void;
}

interface ClaimResult {
  token: string;
  claimUrl: string;
  expiresAt: string;
  emailSent: boolean;
}

export default function ShellClaimDialog(props: ShellClaimDialogProps) {
  const t = useTranslations("Owners.pending");
  const tCommon = useTranslations("Common");
  const [email, setEmail] = useState(props.existingEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  // QR mode skips the email step entirely — auto-submit on open.
  useEffect(() => {
    if (props.mode !== "qr" || result) return;
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);

  useEffect(() => {
    if (!result) return;
    QRCode.toDataURL(result.claimUrl, { width: 320, margin: 2 }).then(
      setQrDataUrl
    );
  }, [result]);

  async function submit(emailOverride?: string) {
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      shellId: props.shellId,
      mode: props.mode,
      locale: props.locale,
    };
    if (props.mode === "email") {
      payload.email = emailOverride ?? email;
    }
    const res = await fetch("/api/admin/shell-users/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || tCommon("saveFailed"));
      setSubmitting(false);
      return;
    }
    const data = (await res.json()) as ClaimResult;
    setResult(data);
    setSubmitting(false);
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.claimUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function printQr() {
    if (!printRef.current) return;
    const printContent = printRef.current.innerHTML;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>QR — ${escapeHtml(
      props.shellName
    )}</title><style>body{font-family:Arial,sans-serif;padding:24px;text-align:center;}img{max-width:100%;}h1{font-size:24px;}p{font-size:18px;}</style></head><body>${printContent}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 250);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {props.mode === "email" ? t("inviteByEmailTitle") : t("qrTitle")}
          </h2>
          <button
            onClick={props.onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none dark:text-gray-400 dark:hover:text-gray-200"
          >
            &times;
          </button>
        </div>

        <p className="text-base text-gray-600 mb-4 dark:text-gray-300">
          {t("inviteForOwner", { name: props.shellName })}
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        {!result && props.mode === "email" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("emailLabel")}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
            >
              {submitting ? t("sending") : t("sendInvitation")}
            </button>
          </form>
        )}

        {!result && props.mode === "qr" && submitting && (
          <p className="text-base text-gray-500 dark:text-gray-400">
            {t("generating")}
          </p>
        )}

        {result && (
          <div className="space-y-4">
            {result.emailSent && (
              <p className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-base dark:bg-green-900/30 dark:text-green-200">
                {t("emailSent")}
              </p>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 dark:bg-gray-900 dark:border-gray-700">
              <p className="text-sm text-gray-600 break-all dark:text-gray-300">
                {result.claimUrl}
              </p>
            </div>

            <button
              onClick={copyLink}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
            >
              {copied ? t("copied") : t("copyLink")}
            </button>

            {qrDataUrl && (
              <>
                <div ref={printRef} className="text-center">
                  <h1>{props.shellName}</h1>
                  <img
                    src={qrDataUrl}
                    alt="QR"
                    width={320}
                    height={320}
                    className="mx-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700"
                  />
                  <p>
                    {t("expiresOn", {
                      date: new Date(result.expiresAt).toLocaleDateString(),
                    })}
                  </p>
                </div>
                <button
                  onClick={printQr}
                  className="w-full py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 text-base font-medium rounded-lg transition-colors dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100"
                >
                  {t("print")}
                </button>
              </>
            )}

            <button
              onClick={props.onClose}
              className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-base font-medium rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {tCommon("close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
