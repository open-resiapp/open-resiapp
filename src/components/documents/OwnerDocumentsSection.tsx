"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, useConfirm } from "@/components/ui";
import DocumentCard, { type DocumentItem } from "./DocumentCard";
import DocumentUploadForm from "./DocumentUploadForm";

// Owner folder (BYT-20261118-005 Phase B). Self-contained; two modes:
//  - board  (`ownerId` given): "Dokumenty vlastníka" on Vlastníci → detail —
//    every doc filed under the owner + docs on their units, incl. "Len výbor",
//    with chips, board actions and one primary "Nahrať dokument" that files
//    under this owner (anchor = their unit, or `fallbackEntityId`).
//  - owner  (no `ownerId`): "Moje dokumenty" — renders NOTHING when empty.
// Mount point for the board mode: src/components/owners/OwnerDetail.tsx
// (owned by another stream — coordinator mounts it).

export default function OwnerDocumentsSection({
  ownerId,
  ownerName,
  unitEntityIds = [],
  fallbackEntityId,
}: {
  ownerId?: string;
  ownerName?: string;
  /** Units the owner currently owns; with exactly one, uploads anchor there. */
  unitEntityIds?: string[];
  /** Anchor when the owner has 0 or several units (the building root). */
  fallbackEntityId?: string;
}) {
  const t = useTranslations("DocumentVisibility");
  const tDocs = useTranslations("Documents");
  const confirm = useConfirm();
  const boardMode = !!ownerId;
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const qs = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : "";
    const res = await fetch(`/api/documents/folder${qs}`);
    setDocs(res.ok ? (await res.json()).documents : []);
  }, [ownerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: tDocs("delete"),
      description: tDocs("confirmDelete"),
      confirmLabel: tDocs("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  if (docs === null) return null;
  if (!boardMode && docs.length === 0) return null; // no empty card for owners

  const anchor =
    unitEntityIds.length === 1 ? unitEntityIds[0] : fallbackEntityId ?? null;

  return (
    <section aria-labelledby="owner-docs-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 id="owner-docs-title" className="text-xl font-semibold text-ui-text">
            {boardMode ? t("folder.title") : t("my.title")}
          </h2>
          {!boardMode && (
            <p className="text-base text-ui-text-muted">{t("my.hint")}</p>
          )}
        </div>
        {boardMode && anchor && ownerId && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? tDocs("form.cancel") : tDocs("upload")}
          </Button>
        )}
      </div>

      {boardMode && showForm && anchor && ownerId && (
        <DocumentUploadForm
          entityId={anchor}
          canFileInternal
          lockedSubject={{ userId: ownerId, name: ownerName ?? "", entityId: anchor }}
          onUploaded={() => {
            setShowForm(false);
            load();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {docs.length === 0 ? (
        <p className="text-base text-ui-text-muted">{t("folder.empty")}</p>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              canManage={boardMode}
              readOnly={!boardMode}
              onDelete={handleDelete}
              onChanged={boardMode ? load : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
