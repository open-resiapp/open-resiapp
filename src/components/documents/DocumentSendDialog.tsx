"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, LoadingBlock, Modal, Textarea } from "@/components/ui";
import { DOCUMENT_EMAIL_MESSAGE_MAX } from "@/lib/documents";
import { documentErrorKey } from "./document-errors";

// "Poslať e-mailom" (BYT-20261118-005 Phase D). Board only. Board-only docs
// are refused — the dialog offers "Najprv sprístupniť vlastníkovi", which
// opens the (audited) visibility dialog; it never auto-widens.

interface Recipient {
  id: string;
  name: string;
  hasEmail: boolean;
  canSee: boolean;
}
interface SendInfo {
  boardOnly: boolean;
  mode: "attachment" | "link";
  attachmentMaxBytes: number;
  recipients: Recipient[];
  smtpConfigured: boolean;
}
interface BulkSummary {
  eligible: number;
  sent: number;
  failed: Record<string, number>;
  noEmail: number;
  cannotSee: number;
}

export default function DocumentSendDialog({
  open,
  onClose,
  onSent,
  onMakeVisible,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  onMakeVisible: () => void;
  documentId: string;
}) {
  const t = useTranslations("DocumentVisibility");
  const [info, setInfo] = useState<SendInfo | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Bulk send: confirm step shows the exact count before anything goes out.
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulk, setBulk] = useState<BulkSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfo(null);
    setError(null);
    setDone(false);
    setConfirmAll(false);
    setBulk(null);
    setMessage("");
    fetch(`/api/documents/${documentId}/send`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: SendInfo) => {
        if (cancelled) return;
        setInfo(j);
        const first = j.recipients.find((r) => r.hasEmail && r.canSee);
        setRecipientId(first?.id ?? "");
      })
      .catch(() => !cancelled && setError(t("errors.generic")));
    return () => {
      cancelled = true;
    };
  }, [open, documentId, t]);

  async function send() {
    if (!recipientId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientUserId: recipientId, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(`errors.${documentErrorKey(j.code)}`));
        return;
      }
      setDone(true);
      onSent();
    } finally {
      setBusy(false);
    }
  }

  const eligibleCount = info
    ? info.recipients.filter((r) => r.hasEmail && r.canSee).length
    : 0;

  async function sendAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, expectedCount: eligibleCount, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(`errors.${documentErrorKey(j.code)}`));
        setConfirmAll(false);
        // Eligible set changed — reload the list so the new count is confirmed.
        if (j.code === "document.send.count_changed") {
          const fresh = await fetch(`/api/documents/${documentId}/send`);
          if (fresh.ok) setInfo((await fresh.json()) as SendInfo);
        }
        return;
      }
      setBulk(j.summary as BulkSummary);
      setDone(true);
      onSent();
    } finally {
      setBusy(false);
    }
  }

  const sizeMb = info ? Math.round(info.attachmentMaxBytes / (1024 * 1024)) : 0;
  const smtpMissing = !!info && !info.smtpConfigured;
  const canSend = !!info && !info.boardOnly && !!recipientId && !done && !smtpMissing;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("send.title")}
      footer={
        done ? (
          <Button onClick={onClose}>{t("dialog.close")}</Button>
        ) : info?.boardOnly ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("dialog.cancel")}
            </Button>
            <Button onClick={onMakeVisible}>{t("send.makeVisible")}</Button>
          </>
        ) : confirmAll ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmAll(false)}>
              {t("dialog.cancel")}
            </Button>
            <Button loading={busy} onClick={sendAll}>
              {t("send.allConfirm", { count: eligibleCount })}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("dialog.cancel")}
            </Button>
            {eligibleCount > 1 && (
              <Button
                variant="secondary"
                disabled={smtpMissing || !info || info.boardOnly}
                onClick={() => setConfirmAll(true)}
              >
                {t("send.allButton", { count: eligibleCount })}
              </Button>
            )}
            <Button loading={busy} disabled={!canSend} onClick={send}>
              {t("send.submit")}
            </Button>
          </>
        )
      }
    >
      {!info && !error ? (
        <LoadingBlock />
      ) : done ? (
        <div role="status" className="space-y-2 text-base text-ui-text">
          {bulk ? (
            <>
              <p>{t("send.allDone", { sent: bulk.sent, total: bulk.eligible })}</p>
              {bulk.eligible - bulk.sent > 0 && (
                <p className="text-ui-danger">
                  {t("send.allNotSent", { count: bulk.eligible - bulk.sent })}
                </p>
              )}
              {bulk.noEmail > 0 && <p>{t("send.allNoEmail", { count: bulk.noEmail })}</p>}
            </>
          ) : (
            <p>{t("send.sent")}</p>
          )}
        </div>
      ) : confirmAll ? (
        <div className="space-y-3 text-base text-ui-text">
          <p className="font-medium">{t("send.allConfirmText", { count: eligibleCount })}</p>
          <p className="text-ui-text-muted">{t("send.irreversible")}</p>
          {error && (
            <p role="alert" className="text-ui-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {smtpMissing && (
            <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger">
              {t("errors.document_send_smtp_missing")}
            </p>
          )}
          {info?.boardOnly ? (
            <p className="text-base text-ui-text">{t("send.boardOnly")}</p>
          ) : info && info.recipients.length === 0 ? (
            <p className="text-base text-ui-text">{t("send.noRecipients")}</p>
          ) : info ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-base font-medium text-ui-text mb-1">
                  {t("send.recipient")}
                </legend>
                {info.recipients.map((r) => {
                  const disabled = !r.hasEmail || !r.canSee;
                  return (
                    <label
                      key={r.id}
                      className="flex items-center gap-3 min-h-11 text-base text-ui-text"
                    >
                      <input
                        type="radio"
                        name="recipient"
                        className="h-5 w-5"
                        value={r.id}
                        disabled={disabled}
                        checked={recipientId === r.id}
                        onChange={() => setRecipientId(r.id)}
                      />
                      <span>
                        {r.name}
                        {!r.hasEmail && ` — ${t("send.noEmail")}`}
                        {r.hasEmail && !r.canSee && ` — ${t("send.cannotSee")}`}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <Field
                label={t("send.message")}
                hint={`${message.length} / ${DOCUMENT_EMAIL_MESSAGE_MAX}`}
              >
                <Textarea
                  value={message}
                  maxLength={DOCUMENT_EMAIL_MESSAGE_MAX}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
              <p className="text-base text-ui-text-muted">
                {info.mode === "attachment"
                  ? t("send.modeAttachment")
                  : t("send.modeLink", { size: sizeMb })}
              </p>
              <p className="text-base text-ui-text-muted">{t("send.irreversible")}</p>
            </>
          ) : null}
          {error && (
            <p role="alert" className="text-base text-ui-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
