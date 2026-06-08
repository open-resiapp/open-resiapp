"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DOCUMENT_AUDIENCES,
  DOCUMENT_PROJECT_STATUSES,
  type DocumentAudience,
  type DocumentProjectStatus,
} from "@/lib/documents";
import DocumentCard, { type DocumentItem } from "./DocumentCard";

export interface ProjectItem {
  id: string;
  title: string;
  description: string | null;
  audience: DocumentAudience;
  status: DocumentProjectStatus;
  documentCount: number;
}

const STATUS_STYLES: Record<DocumentProjectStatus, string> = {
  planned: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  active: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
};

const inputCls =
  "w-full px-4 py-2 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100";
const labelCls =
  "block text-sm font-medium text-gray-700 mb-1 dark:text-gray-300";

export default function ProjectsPanel({
  projects,
  canManage,
  onChanged,
}: {
  projects: ProjectItem[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("Documents");
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      {canManage && (
        <div className="mb-4">
          {showForm ? (
            <NewProjectForm
              onCreated={() => {
                setShowForm(false);
                onChanged();
              }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg"
            >
              {t("projects.new")}
            </button>
          )}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
          {t("projects.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              canManage={canManage}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Documents");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<DocumentAudience>("owner");
  const [status, setStatus] = useState<DocumentProjectStatus>("active");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/documents/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description, audience, status }),
      });
      if (res.ok) onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white rounded-2xl shadow-sm p-6 space-y-4 dark:bg-gray-800 dark:shadow-black/40"
    >
      <div>
        <label className={labelCls}>{t("projects.form.title")}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>{t("projects.form.description")}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>{t("projects.form.audience")}</label>
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
        <div>
          <label className={labelCls}>{t("projects.form.status")}</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DocumentProjectStatus)}
            className={inputCls}
          >
            {DOCUMENT_PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`projects.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 px-4 py-3 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {t("projects.form.submit")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          {t("projects.form.cancel")}
        </button>
      </div>
    </form>
  );
}

function ProjectRow({
  project,
  canManage,
  onChanged,
}: {
  project: ProjectItem;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("Documents");
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && docs === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/projects/${project.id}`);
        if (res.ok) {
          const j = await res.json();
          setDocs(j.documents);
        }
      } finally {
        setLoading(false);
      }
    }
  }

  async function del() {
    if (!confirm(t("projects.confirmDelete"))) return;
    const res = await fetch(`/api/documents/projects/${project.id}`, {
      method: "DELETE",
    });
    if (res.ok) onChanged();
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm dark:bg-gray-800 dark:shadow-black/40">
      <div className="p-5 flex items-start gap-4">
        <span className="text-2xl shrink-0" aria-hidden>
          📁
        </span>
        <button
          onClick={toggle}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[project.status]}`}
            >
              {t(`projects.status.${project.status}`)}
            </span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
              {t(`audience.${project.audience}`)}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {t("projects.docCount", { count: project.documentCount })}
            </span>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mt-2 dark:text-gray-100">
            {project.title}
          </h3>
          {project.description && (
            <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">
              {project.description}
            </p>
          )}
        </button>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={toggle}
            className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg dark:text-blue-300 dark:hover:bg-blue-900/30"
          >
            {open ? t("projects.close") : t("projects.open")}
          </button>
          {canManage && (
            <button
              onClick={del}
              className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg dark:text-red-400 dark:hover:bg-red-900/30"
            >
              {t("projects.delete")}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">…</p>
          ) : docs && docs.length > 0 ? (
            docs.map((d) => (
              <DocumentCard key={d.id} doc={d} canManage={false} onDelete={() => {}} readOnly />
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
