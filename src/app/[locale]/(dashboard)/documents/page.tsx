"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents";
import DocumentCard, {
  type DocumentItem,
} from "@/components/documents/DocumentCard";
import DocumentUploadForm from "@/components/documents/DocumentUploadForm";

interface DocumentsResponse {
  entityId: string | null;
  canUpload: boolean;
  isManager: boolean;
  documents: DocumentItem[];
}

export default function DocumentsPage() {
  const t = useTranslations("Documents");
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DocumentType | "all">("all");
  const [showForm, setShowForm] = useState(false);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/documents");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  async function handleDelete(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (res.ok) fetchDocs();
  }

  const docs = data?.documents ?? [];
  const visible = filter === "all" ? docs : docs.filter((d) => d.type === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        {data?.canUpload && data.entityId && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            {showForm ? t("form.cancel") : t("upload")}
          </button>
        )}
      </div>
      <p className="text-gray-500 mb-6 dark:text-gray-400">{t("description")}</p>

      {showForm && data?.entityId && (
        <div className="mb-6">
          <DocumentUploadForm
            entityId={data.entityId}
            onUploaded={() => {
              setShowForm(false);
              fetchDocs();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="mb-4">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as DocumentType | "all")}
          className="px-4 py-2 border border-gray-300 rounded-lg text-base dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
        >
          <option value="all">{t("filterAll")}</option>
          {DOCUMENT_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`type.${ty}`)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl shadow-sm p-6 animate-pulse dark:bg-gray-800 dark:shadow-black/40"
            >
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-3 dark:bg-gray-700" />
              <div className="h-5 bg-gray-200 rounded w-3/4 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              canManage={data?.isManager ?? false}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
