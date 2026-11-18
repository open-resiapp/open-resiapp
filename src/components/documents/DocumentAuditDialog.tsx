"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LoadingBlock, Modal } from "@/components/ui";
import type { DocumentAudience } from "@/lib/documents";

// Board-only document history (BYT-20261118-005): upload, visibility and
// owner changes, delete, e-mail sends. The API answers 404 to non-board.

interface AuditEntry {
  id: string;
  action:
    | "document.upload"
    | "document.set_audience"
    | "document.set_subject"
    | "document.delete"
    | "document.email_sent";
  actorName: string | null;
  createdAt: string;
  before: { audience: DocumentAudience | null; subjectName: string | null };
  after: {
    audience: DocumentAudience | null;
    subjectName: string | null;
    recipientName: string | null;
    mode: "attachment" | "link" | null;
  };
}

export default function DocumentAuditDialog({
  open,
  onClose,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
}) {
  const t = useTranslations("DocumentVisibility");
  const tDocs = useTranslations("Documents");
  const format = useFormatter();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntries(null);
    setFailed(false);
    fetch(`/api/documents/${documentId}/audit`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => !cancelled && setEntries(j.entries))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  const aud = (a: DocumentAudience | null) =>
    a ? tDocs(`audience.${a}`) : t("history.unknown");

  function line(e: AuditEntry): string {
    const name = e.actorName ?? t("history.unknown");
    switch (e.action) {
      case "document.upload":
        return t("history.upload", { name, audience: aud(e.after.audience) });
      case "document.set_audience":
        return t("history.setAudience", {
          name,
          from: aud(e.before.audience),
          to: aud(e.after.audience),
        });
      case "document.set_subject":
        return t("history.setSubject", {
          name,
          from: e.before.subjectName ?? t("history.nobody"),
          to: e.after.subjectName ?? t("history.nobody"),
        });
      case "document.delete":
        return t("history.delete", { name });
      case "document.email_sent":
        return t("history.emailSent", {
          name,
          recipient: e.after.recipientName ?? t("history.unknown"),
          mode:
            e.after.mode === "link"
              ? t("history.modeLink")
              : t("history.modeAttachment"),
        });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("history.title")}>
      {failed ? (
        <p role="alert" className="text-base text-ui-danger">
          {t("errors.generic")}
        </p>
      ) : !entries ? (
        <LoadingBlock />
      ) : entries.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("history.empty")}</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="text-base text-ui-text">
              <span className="block">{line(e)}</span>
              <span className="block text-ui-text-muted">
                {format.dateTime(new Date(e.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
