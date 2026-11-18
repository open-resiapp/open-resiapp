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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfo(null);
    setError(null);
    setDone(false);
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

  const sizeMb = info ? Math.round(info.attachmentMaxBytes / (1024 * 1024)) : 0;
  const canSend = !!info && !info.boardOnly && !!recipientId && !done;

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
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("dialog.cancel")}
            </Button>
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
        <p role="status" className="text-base text-ui-text">
          {t("send.sent")}
        </p>
      ) : (
        <div className="space-y-4">
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
