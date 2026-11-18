"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import {
  DOCUMENT_TYPES,
  DOCUMENT_AUDIENCES,
  DEFAULT_AUDIENCE_BY_TYPE,
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_SIZE,
  type DocumentType,
  type DocumentAudience,
} from "@/lib/documents";

import { documentErrorKey } from "./document-errors";

const ACCEPT = Object.keys(ALLOWED_DOCUMENT_MIME).join(",");

const inputCls =
  "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100";
const labelCls =
  "block text-base font-medium text-gray-700 mb-1 dark:text-gray-300";

interface SubjectCandidate {
  userId: string;
  name: string;
  unitEntityId: string;
  unitLabel: string;
}

export default function DocumentUploadForm({
  entityId,
  projects = [],
  lockedProjectId,
  onUploaded,
  onCancel,
  canFileInternal: canFileInternalProp,
  lockedSubject,
}: {
  entityId: string;
  projects?: { id: string; title: string }[];
  lockedProjectId?: string;
  onUploaded: () => void;
  onCancel: () => void;
  /** Board: may pick "Len výbor" and file under an owner (BYT-20261118-005).
   *  Non-board uploaders never see the admin tier (server refuses it). */
  canFileInternal?: boolean;
  /** Owner folder: subject + anchor fixed (owner detail). Defaults to "Len výbor". */
  lockedSubject?: { userId: string; name: string; entityId: string };
}) {
  const t = useTranslations("Documents");
  const tv = useTranslations("DocumentVisibility");
  const { data: session } = useSession();
  // Default: board role. The server re-checks admin membership on the line.
  const canFileInternal =
    canFileInternalProp ?? session?.user?.role === "admin";
  const audiences = canFileInternal
    ? DOCUMENT_AUDIENCES
    : DOCUMENT_AUDIENCES.filter((a) => a !== "admin");
  const defaultAudienceFor = (ty: DocumentType): DocumentAudience => {
    if (lockedSubject) return "admin"; // safe default for owner-folder docs
    const d = DEFAULT_AUDIENCE_BY_TYPE[ty];
    return d === "admin" && !canFileInternal ? "owner" : d;
  };
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<DocumentType>("other");
  const [audience, setAudience] = useState<DocumentAudience>(
    defaultAudienceFor("other")
  );
  // "Komu patrí": "" = celý dom; else `${userId}|${unitEntityId}`.
  const [belongsTo, setBelongsTo] = useState("");
  const [candidates, setCandidates] = useState<SubjectCandidate[]>([]);
  const [subjectQuery, setSubjectQuery] = useState("");

  // Session may resolve after mount — re-apply the type default once the
  // board role is known so "Len výbor" defaults are not silently widened.
  useEffect(() => {
    if (!belongsTo) setAudience(defaultAudienceFor(type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFileInternal]);

  useEffect(() => {
    if (!canFileInternal || lockedSubject) return;
    let cancelled = false;
    fetch("/api/documents/subjects")
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((j) => !cancelled && setCandidates(j.candidates ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canFileInternal, lockedSubject]);
  const [retainUntil, setRetainUntil] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Type drives the default audience (the §11 mapping); admin may still narrow.
  function handleType(next: DocumentType) {
    setType(next);
    if (!belongsTo) setAudience(defaultAudienceFor(next));
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
      const [subjectId, unitId] = lockedSubject
        ? [lockedSubject.userId, lockedSubject.entityId]
        : belongsTo
          ? belongsTo.split("|")
          : [null, null];
      fd.append("entityId", unitId || entityId);
      if (subjectId) fd.append("subjectUserId", subjectId);
      fd.append("type", type);
      fd.append("audience", audience);
      if (name.trim()) fd.append("name", name.trim());
      if (retainUntil) fd.append("retainUntil", retainUntil);
      const pid = lockedProjectId ?? projectId;
      if (pid) fd.append("projectId", pid);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (typeof j.code === "string") {
          setError(tv(`errors.${documentErrorKey(j.code)}`));
          return;
        }
        throw new Error();
      }
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
          className="block text-base dark:text-gray-300"
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
            {audiences.map((a) => (
              <option key={a} value={a}>
                {t(`audience.${a}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {lockedSubject ? (
        <p className="text-base text-gray-700 dark:text-gray-300">
          {tv("upload.lockedSubject", { name: lockedSubject.name })}
        </p>
      ) : (
        canFileInternal &&
        candidates.length > 0 && (
          <div>
            <label className={labelCls} htmlFor="doc-belongs-to">
              {tv("upload.belongsTo")}
            </label>
            <input
              type="search"
              value={subjectQuery}
              onChange={(e) => setSubjectQuery(e.target.value)}
              placeholder={tv("upload.search")}
              aria-label={tv("upload.search")}
              className={`${inputCls} mb-2`}
            />
            <select
              id="doc-belongs-to"
              value={belongsTo}
              onChange={(e) => {
                setBelongsTo(e.target.value);
                // Filing under a person defaults to the safe "Len výbor".
                if (e.target.value) setAudience("admin");
              }}
              className={inputCls}
            >
              <option value="">{tv("upload.wholeBuilding")}</option>
              {candidates
                .filter(
                  (c) =>
                    !subjectQuery.trim() ||
                    `${c.name} ${c.unitLabel}`
                      .toLocaleLowerCase()
                      .includes(subjectQuery.trim().toLocaleLowerCase()) ||
                    `${c.userId}|${c.unitEntityId}` === belongsTo
                )
                .map((c) => (
                  <option
                    key={`${c.userId}|${c.unitEntityId}`}
                    value={`${c.userId}|${c.unitEntityId}`}
                  >
                    {tv("upload.ownerOption", { name: c.name, unit: c.unitLabel })}
                  </option>
                ))}
            </select>
          </div>
        )
      )}

      <div>
        <label className={labelCls}>{t("form.retainUntil")}</label>
        <input
          type="date"
          value={retainUntil}
          onChange={(e) => setRetainUntil(e.target.value)}
          className={inputCls}
        />
        <p className="text-base text-gray-400 mt-1 dark:text-gray-500">
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

      {error && <p className="text-base text-red-600 dark:text-red-400">{error}</p>}

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
