"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";

import { Button, Field, Modal, Select } from "@/components/ui";
import type { UnitOption } from "@/lib/owners-board";

interface InvitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  units: UnitOption[];
}

/**
 * Generic registration link without a named person (role + optional unit).
 * Request unchanged: POST /api/invitations {role, flatId, expiresInDays}.
 * Reachable from "Pridať vlastníka" → "Ďalšie možnosti". The unit list comes
 * from the server-rendered page.
 */
export default function InvitationModal({ isOpen, onClose, units }: InvitationModalProps) {
  if (!isOpen) return null;
  return <InvitationModalBody onClose={onClose} units={units} />;
}

function InvitationModalBody({ onClose, units }: Omit<InvitationModalProps, "isOpen">) {
  const t = useTranslations("Invitations");
  const tCommon = useTranslations("Common");
  const [role, setRole] = useState("owner");
  const [flatId, setFlatId] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [generatedUrl, setGeneratedUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, flatId: flatId || null, expiresInDays }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || t("error"));
      setLoading(false);
      return;
    }

    const data = await res.json();
    setGeneratedUrl(data.url);
    setQrDataUrl(await QRCode.toDataURL(data.url, { width: 256, margin: 2 }));
    setLoading(false);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const formId = "generic-invitation-form";

  return (
    <Modal
      open
      onClose={onClose}
      title={t("title")}
      footer={
        generatedUrl ? (
          <Button variant="secondary" onClick={onClose}>
            {t("close")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" form={formId} loading={loading}>
              {loading ? t("generating") : t("generate")}
            </Button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
          {error}
        </p>
      )}

      {!generatedUrl ? (
        <form id={formId} onSubmit={handleGenerate} className="space-y-4">
          <Field label={t("roleLabel")}>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="owner">{t("roleOwner")}</option>
              <option value="tenant">{t("roleTenant")}</option>
              <option value="vote_counter">{t("roleVoteCounter")}</option>
              <option value="caretaker">{t("roleCaretaker")}</option>
            </Select>
          </Field>

          <Field label={t("flatLabel")}>
            <Select value={flatId} onChange={(e) => setFlatId(e.target.value)}>
              <option value="">{t("noFlat")}</option>
              {units.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.flatNumber}
                  {f.entranceName ? ` (${f.entranceName})` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("expiryLabel")}>
            <Select value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}>
              <option value={7}>{t("days7")}</option>
              <option value={14}>{t("days14")}</option>
              <option value={30}>{t("days30")}</option>
            </Select>
          </Field>
        </form>
      ) : (
        <div className="space-y-4">
          <p role="status" className="rounded-lg border border-ui-success/30 bg-ui-success/10 px-4 py-3 font-medium text-ui-success">
            {t("linkReady")}
          </p>

          <p className="break-all rounded-lg border border-ui-border bg-ui-surface-muted p-3 text-base text-ui-text">
            {generatedUrl}
          </p>

          <Button fullWidth onClick={handleCopy}>
            {copied ? t("copied") : t("copyLink")}
          </Button>

          {qrDataUrl && (
            <div className="text-center">
              <p className="mb-2 font-medium text-ui-text">{t("qrCode")}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={t("qrCode")}
                className="mx-auto max-w-full rounded-lg border border-ui-border bg-white"
                width={256}
                height={256}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
