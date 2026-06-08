"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ALLOWED_DOCUMENT_MIME, MAX_DOCUMENT_SIZE } from "@/lib/documents";

export interface AttachedDoc {
  id: string;
  name: string;
}

type LinkTarget = "board_post" | "community_post";

// Attach documents to a post. Two modes:
//  - deferred (no targetId): manages a local list; parent persists on create.
//  - live (targetId set): links/unlinks immediately via /api/document-links.
// Upload-new documents inherit the post's reach (audience = resident). The
// document also lands in the library. BYT-20260608-001 Phase B.
export default function DocumentAttachmentPicker({
  value,
  onChange,
  targetType,
  targetId,
}: {
  value: AttachedDoc[];
  onChange: (docs: AttachedDoc[]) => void;
  targetType?: LinkTarget;
  targetId?: string;
}) {
  const t = useTranslations("Documents");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [library, setLibrary] = useState<AttachedDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = !!(targetId && targetType);

  useEffect(() => {
    let active = true;
    fetch("/api/documents")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        setEntityId(d.entityId ?? null);
        setLibrary(
          (d.documents ?? []).map((x: { id: string; name: string }) => ({
            id: x.id,
            name: x.name,
          }))
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const add = useCallback(
    async (doc: AttachedDoc) => {
      if (value.some((v) => v.id === doc.id)) return;
      if (live) {
        await fetch("/api/document-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, documentId: doc.id }),
        });
      }
      onChange([...value, doc]);
    },
    [value, onChange, live, targetType, targetId]
  );

  const remove = useCallback(
    async (id: string) => {
      if (live) {
        await fetch(
          `/api/document-links?targetType=${targetType}&targetId=${targetId}&documentId=${id}`,
          { method: "DELETE" }
        );
      }
      onChange(value.filter((v) => v.id !== id));
    },
    [value, onChange, live, targetType, targetId]
  );

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    if (!ALLOWED_DOCUMENT_MIME[f.type]) {
      setError(t("errors.notAllowed"));
      e.target.value = "";
      return;
    }
    if (f.size > MAX_DOCUMENT_SIZE) {
      setError(t("errors.tooLarge"));
      e.target.value = "";
      return;
    }
    if (!entityId) {
      setError(t("errors.uploadFailed"));
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("entityId", entityId);
      fd.append("type", "other");
      fd.append("audience", "resident"); // inherit the post's reach
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const { document } = await res.json();
      await add({ id: document.id, name: document.name });
    } catch {
      setError(t("errors.uploadFailed"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const available = library.filter((l) => !value.some((v) => v.id === l.id));

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t("attachments.label")}
      </label>

      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 dark:bg-gray-900"
            >
              <span className="truncate dark:text-gray-100">📄 {d.name}</span>
              <button
                type="button"
                onClick={() => remove(d.id)}
                className="text-red-600 hover:underline shrink-0 dark:text-red-400"
              >
                {t("attachments.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const d = available.find((a) => a.id === e.target.value);
              if (d) add(d);
            }}
            className="text-sm px-3 py-2 border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
          >
            <option value="">{t("attachments.fromLibrary")}</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <label className="text-sm px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-200">
          {uploading ? t("attachments.uploading") : t("attachments.uploadNew")}
          <input
            type="file"
            accept={Object.keys(ALLOWED_DOCUMENT_MIME).join(",")}
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
