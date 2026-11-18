"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Modal, Select, useConfirm } from "@/components/ui";
import { DOCUMENT_AUDIENCES, type DocumentAudience } from "@/lib/documents";
import { documentErrorKey } from "./document-errors";

// Board-only "Kto vidí dokument" (BYT-20261118-005). Narrowing is immediate;
// widening (lower tier → higher tier, or removing the owner-folder subject)
// asks for a confirm that names who gains access. Never notifies anyone.

const RANK: Record<DocumentAudience, number> = { admin: 0, owner: 1, resident: 2 };

export default function DocumentVisibilityDialog({
  open,
  onClose,
  onSaved,
  documentId,
  audience,
  subjectUserId,
  subjectName,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  documentId: string;
  audience: DocumentAudience;
  subjectUserId: string | null;
  subjectName: string | null;
}) {
  const t = useTranslations("DocumentVisibility");
  const tDocs = useTranslations("Documents");
  const confirm = useConfirm();
  const [next, setNext] = useState<DocumentAudience>(audience);
  const [keepSubject, setKeepSubject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removesSubject = !!subjectUserId && !keepSubject;
  const widens =
    (RANK[next] > RANK[audience] && next !== "admin") ||
    (removesSubject && next !== "admin");

  async function save() {
    setError(null);
    if (widens) {
      const who =
        subjectUserId && keepSubject
          ? t("widen.subject", { name: subjectName ?? "—" })
          : next === "resident"
            ? t("widen.resident")
            : t("widen.owner");
      const ok = await confirm({
        title: t("widen.title"),
        description: `${who} ${t("widen.noNotify")}`,
        confirmLabel: t("widen.confirm"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (next !== audience) body.audience = next;
      if (removesSubject) body.subjectUserId = null;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(t(`errors.${documentErrorKey(j.code)}`));
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("dialog.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("dialog.cancel")}
          </Button>
          <Button loading={busy} onClick={save}>
            {t("dialog.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("dialog.audience")}>
          <Select
            value={next}
            onChange={(e) => setNext(e.target.value as DocumentAudience)}
          >
            {DOCUMENT_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {tDocs(`audience.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        {subjectUserId && (
          <label className="flex items-start gap-3 text-base text-ui-text min-h-11">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={keepSubject}
              onChange={(e) => setKeepSubject(e.target.checked)}
            />
            <span>{t("dialog.keepSubject", { name: subjectName ?? "—" })}</span>
          </label>
        )}
        <p className="text-base text-ui-text-muted">{t("dialog.hint")}</p>
        {error && (
          <p role="alert" className="text-base text-ui-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
