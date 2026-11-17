"use client";

// "Na spracovanie" — uploaded invoices waiting to be posted (BYT-20261117-002;
// collector inbox from BYT-20260512-002 AC 478/479). The treasurer uploads a
// PDF/image → OCR parks a pending row with suggested IČO / IBAN / VS /
// amount → "Zaúčtovať" opens the invoice form prefilled. OCR values are
// suggestions only; the parked scan becomes the doklad's mandatory
// attachment (AC 440). Treasurer/admin only (writer-guarded API).
//
// The email-inbound half of AC 478 (collector address + AV + allowlist,
// AC 480) stays BLOCKED — needs mail + AV infra.

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Icon } from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";
import type { ExpensePrefill } from "./ExpenseFormModal";

interface InboxItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  ocrEngine: string | null;
  ocrIco: string | null;
  ocrDic: string | null;
  ocrIban: string | null;
  ocrVs: string | null;
  ocrAmountCents: number | null;
  ocrConfidencePct: number | null;
  status: string;
  createdAt: string;
}

export default function ExpenseInbox({
  inputRef,
  reloadKey,
  onPost,
}: {
  /** Hidden file input; the page's "Nahrať faktúru" button clicks it. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Bump to reload (e.g. after an item was posted as an expense). */
  reloadKey: number;
  onPost: (prefill: ExpensePrefill) => void;
}) {
  const t = useTranslations("Accounting.inbox");
  const format = useFormatter();

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<InboxItem | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/accounting/expense-inbox")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { items: InboxItem[] }) => setItems(data.items))
      .catch(() => setError("load"));
  }, []);

  useEffect(load, [load, reloadKey]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    e.target.value = "";
    setUploading(true);
    setError(null);
    try {
      // Sequential — each file is OCR'd server-side.
      for (const f of list) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/accounting/expense-inbox", { method: "POST", body: fd });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? String(res.status));
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload");
    } finally {
      setUploading(false);
    }
  }

  async function dismiss() {
    if (!dismissTarget) return;
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/expense-inbox/${dismissTarget.id}/dismiss`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setDismissTarget(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "dismiss");
    } finally {
      setDismissing(false);
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={onUpload}
    />
  );

  const count = items?.length ?? 0;
  // Nothing pending and nothing happening → only the hidden input.
  if (count === 0 && !uploading && !error) return fileInput;

  return (
    <section aria-labelledby="inbox-title" className="mb-8">
      {fileInput}
      <h2 id="inbox-title" className="mb-1 text-lg font-semibold text-ui-text">
        {t("pendingTitle", { count })}
      </h2>
      <p className="mb-3 text-base text-ui-text-muted">
        {uploading ? t("uploading") : t("uploadHint")}
      </p>
      {error && (
        <p role="alert" className="mb-3 text-base font-medium text-ui-danger">
          {error === "load" ? t("loadError") : `${t("actionError")} (${error})`}
        </p>
      )}
      <ul className="space-y-3">
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <Card padding="sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-base font-medium text-ui-text">
                    <Icon name="file" size={20} />
                    <span className="truncate">{item.fileName}</span>
                  </p>
                  <p className="text-base text-ui-text-muted">
                    {format.dateTime(new Date(item.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {" · "}
                    {item.ocrEngine === "none" || item.ocrConfidencePct === 0
                      ? t("ocrNone")
                      : t("ocrConfidence", { pct: item.ocrConfidencePct ?? 0 })}
                  </p>
                  <p className="flex flex-wrap gap-x-4 text-base text-ui-text-muted">
                    {item.ocrIco && <span>{t("ocrIco", { ico: item.ocrIco })}</span>}
                    {item.ocrIban && <span className="break-all font-mono">{item.ocrIban}</span>}
                    {item.ocrVs && <span>{t("ocrVs", { vs: item.ocrVs })}</span>}
                    {item.ocrAmountCents != null && <span>{formatEur(item.ocrAmountCents)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      onPost({
                        inboxItemId: item.id,
                        fileName: item.fileName,
                        ico: item.ocrIco,
                        dic: item.ocrDic,
                        iban: item.ocrIban,
                        vs: item.ocrVs,
                        amountCents: item.ocrAmountCents,
                      })
                    }
                  >
                    {t("postAsExpense")}
                  </Button>
                  <Button variant="ghost" onClick={() => setDismissTarget(item)}>
                    {t("dismiss")}
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={dismissTarget !== null}
        title={t("dismissTitle")}
        description={t("dismissConsequence", { file: dismissTarget?.fileName ?? "" })}
        confirmLabel={t("dismiss")}
        loading={dismissing}
        onConfirm={dismiss}
        onCancel={() => setDismissTarget(null)}
      />
    </section>
  );
}
