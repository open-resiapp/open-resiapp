"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents";
import DocumentCard, {
  type DocumentItem,
} from "@/components/documents/DocumentCard";
import DocumentUploadForm from "@/components/documents/DocumentUploadForm";
import ProjectsPanel, {
  type ProjectItem,
} from "@/components/documents/ProjectsPanel";

interface DocumentsResponse {
  entityId: string | null;
  canUpload: boolean;
  isManager: boolean;
  documents: DocumentItem[];
}
interface ProjectsResponse {
  entityId: string | null;
  canManage: boolean;
  projects: ProjectItem[];
}

function SkeletonList() {
  return (
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
  );
}

export default function DocumentsPage() {
  const t = useTranslations("Documents");
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [projectsData, setProjectsData] = useState<ProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DocumentType | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"documents" | "projects">("documents");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([
        fetch("/api/documents").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/documents/projects").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (d) setData(d);
      if (p) setProjectsData(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleDelete(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (res.ok) fetchAll();
  }

  async function handleAssignProject(id: string, projectId: string | null) {
    const res = await fetch(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (res.ok) fetchAll();
  }

  const docs = data?.documents ?? [];
  const visible = filter === "all" ? docs : docs.filter((d) => d.type === filter);
  const projectOptions = (projectsData?.projects ?? []).map((p) => ({
    id: p.id,
    title: p.title,
  }));

  const tabBtn = (key: "documents" | "projects", label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-base font-medium rounded-lg ${
        tab === key
          ? "bg-blue-600 text-white"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1 dark:text-gray-100">
        {t("title")}
      </h1>
      <p className="text-gray-500 mb-4 dark:text-gray-400">{t("description")}</p>

      <div className="flex gap-2 mb-6">
        {tabBtn("documents", t("documentsTab"))}
        {tabBtn("projects", t("projectsTab"))}
      </div>

      {tab === "documents" ? (
        <>
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
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
            {data?.canUpload && data.entityId && (
              <button
                onClick={() => setShowForm((v) => !v)}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
              >
                {showForm ? t("form.cancel") : t("upload")}
              </button>
            )}
          </div>

          {showForm && data?.entityId && (
            <div className="mb-6">
              <DocumentUploadForm
                entityId={data.entityId}
                projects={projectOptions}
                onUploaded={() => {
                  setShowForm(false);
                  fetchAll();
                }}
                onCancel={() => setShowForm(false)}
              />
            </div>
          )}

          {loading ? (
            <SkeletonList />
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
                  projects={projectOptions}
                  onAssignProject={handleAssignProject}
                />
              ))}
            </div>
          )}
        </>
      ) : loading ? (
        <SkeletonList />
      ) : (
        <ProjectsPanel
          projects={projectsData?.projects ?? []}
          canManage={projectsData?.canManage ?? false}
          entityId={projectsData?.entityId ?? null}
          onChanged={fetchAll}
        />
      )}
    </div>
  );
}
