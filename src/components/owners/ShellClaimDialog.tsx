"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import QRCode from "qrcode";

import { Button, Field, Input, Modal } from "@/components/ui";

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
  emailStatus: "sent" | "not_configured" | "failed" | "not_requested";
}

/**
 * Invite one owner record (shell user) to claim its account: by e-mail or as
 * a printable QR letter. Request unchanged: POST /api/admin/shell-users/claim
 * {shellId, mode, locale, email?}. Mounted only while open.
 */
export default function ShellClaimDialog(props: ShellClaimDialogProps) {
  const t = useTranslations("Owners.pending");
  const tBoard = useTranslations("Owners.board");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const [mode, setMode] = useState<"email" | "qr">(props.mode);
  const [email, setEmail] = useState(props.existingEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);
  // Guards the QR auto-submit against a double effect run (one invitation per open).
  const qrRequested = useRef(false);

  // QR mode skips the e-mail step entirely — submit as soon as it is chosen.
  useEffect(() => {
    if (mode !== "qr" || result || qrRequested.current) return;
    qrRequested.current = true;
    void submit("qr");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!result) return;
    QRCode.toDataURL(result.claimUrl, { width: 320, margin: 2 }).then(setQrDataUrl);
  }, [result]);

  async function submit(submitMode: "email" | "qr") {
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      shellId: props.shellId,
      mode: submitMode,
      locale: props.locale,
    };
    if (submitMode === "email") payload.email = email;
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
    setResult((await res.json()) as ClaimResult);
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
    w.document.write(
      `<!DOCTYPE html><html><head><title>QR — ${escapeHtml(
        props.shellName
      )}</title><style>body{font-family:Arial,sans-serif;padding:24px;text-align:center;}img{max-width:100%;}h1{font-size:24px;}p{font-size:18px;word-break:break-all;}</style></head><body>${printContent}</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 250);
  }

  const title = mode === "email" ? t("inviteByEmailTitle") : t("qrTitle");

  return (
    <Modal
      open
      onClose={props.onClose}
      title={title}
      footer={
        result ? (
          <Button variant="secondary" onClick={props.onClose}>
            {tCommon("close")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <p className="text-ui-text-muted">{t("inviteForOwner", { name: props.shellName })}</p>

        {error && (
          <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
            {error}
          </p>
        )}

        {!result && mode === "email" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("email");
            }}
            className="space-y-4"
          >
            <Field label={t("emailLabel")} required>
              <Input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={submitting} fullWidth>
              {submitting ? t("sending") : t("sendInvitation")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setMode("qr")} disabled={submitting}>
              {tBoard("switchToQr")}
            </Button>
          </form>
        )}

        {!result && mode === "qr" && submitting && (
          <p className="text-ui-text-muted" role="status">
            {t("generating")}
          </p>
        )}

        {result && (
          <div className="space-y-4">
            {result.emailSent && (
              <p role="status" className="rounded-lg border border-ui-success/30 bg-ui-success/10 px-4 py-3 text-ui-success">
                {t("emailSent")}
              </p>
            )}

            {(result.emailStatus === "not_configured" || result.emailStatus === "failed") && (
              <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
                {result.emailStatus === "not_configured" ? t("emailNotConfigured") : t("emailFailed")}
              </p>
            )}

            <p className="break-all rounded-lg border border-ui-border bg-ui-surface-muted p-3 text-base text-ui-text">
              {result.claimUrl}
            </p>

            <Button variant="secondary" fullWidth onClick={copyLink}>
              {copied ? t("copied") : t("copyLink")}
            </Button>

            {qrDataUrl && (
              <>
                <div ref={printRef} className="text-center">
                  <h1 className="text-lg font-semibold">{props.shellName}</h1>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt={t("qrTitle")}
                    width={320}
                    height={320}
                    className="mx-auto max-w-full rounded-lg border border-ui-border bg-white"
                  />
                  <p>
                    {t("expiresOn", {
                      date: format.dateTime(new Date(result.expiresAt), { dateStyle: "medium" }),
                    })}
                  </p>
                </div>
                <Button fullWidth onClick={printQr}>
                  {t("print")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
