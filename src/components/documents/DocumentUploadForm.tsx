"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DOCUMENT_TYPES,
  DOCUMENT_AUDIENCES,
  DEFAULT_AUDIENCE_BY_TYPE,
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_SIZE,
  type DocumentType,
  type DocumentAudience,
} from "@/lib/documents";

const ACCEPT = Object.keys(ALLOWED_DOCUMENT_MIME).join(",");

const inputCls =
  "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100";
const labelCls =
  "block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300";

export default function DocumentUploadForm({
  entityId,
  projects = [],
  lockedProjectId,
  onUploaded,
  onCancel,
}: {
  entityId: string;
  projects?: { id: string; title: string }[];
  lockedProjectId?: string;
  onUploaded: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Documents");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<DocumentType>("other");
  const [audience, setAudience] = useState<DocumentAudience>(
    DEFAULT_AUDIENCE_BY_TYPE.other
  );
  const [retainUntil, setRetainUntil] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Type drives the default audience (the §11 mapping); admin may still narrow.
  function handleType(next: DocumentType) {
    setType(next);
    setAudience(DEFAULT_AUDIENCE_BY_TYPE[next]);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f) {
      if (!ALLOWED_DOCUMENT_MIME[f.type]) {
        setError(t("errors.notAllowed"));
        setFile(null);
        return;
      }
      if (f.size > MAX_DOCUMENT_SIZE) {
        setError(t("errors.tooLarge"));
        setFile(null);
        return;
      }
    }
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError(t("errors.fileRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entityId", entityId);
      fd.append("type", type);
      fd.append("audience", audience);
      if (name.trim()) fd.append("name", name.trim());
      if (retainUntil) fd.append("retainUntil", retainUntil);
      const pid = lockedProjectId ?? projectId;
      if (pid) fd.append("projectId", pid);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      onUploaded();
    } catch {
      setError(t("errors.uploadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl shadow-sm p-6 space-y-4 dark:bg-gray-800 dark:shadow-black/40"
    >
      <div>
        <label className={labelCls}>{t("form.file")}</label>
        <input
          type="file"
          accept={ACCEPT}
          onChange={handleFile}
          className="block text-sm dark:text-gray-300"
        />
      </div>

      <div>
        <label className={labelCls}>{t("form.name")}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          placeholder={t("form.namePlaceholder")}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>{t("form.type")}</label>
          <select
            value={type}
            onChange={(e) => handleType(e.target.value as DocumentType)}
            className={inputCls}
          >
            {DOCUMENT_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`type.${ty}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t("form.audience")}</label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as DocumentAudience)}
            className={inputCls}
          >
            {DOCUMENT_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {t(`audience.${a}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>{t("form.retainUntil")}</label>
        <input
          type="date"
          value={retainUntil}
          onChange={(e) => setRetainUntil(e.target.value)}
          className={inputCls}
        />
        <p className="text-xs text-gray-400 mt-1 dark:text-gray-500">
          {t("form.retainHint")}
        </p>
      </div>

      {!lockedProjectId && projects.length > 0 && (
        <div>
          <label className={labelCls}>{t("form.project")}</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={inputCls}
          >
            <option value="">{t("noProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 px-4 py-3 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {submitting ? t("form.uploading") : t("form.submit")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          {t("form.cancel")}
        </button>
      </div>
    </form>
  );
}
