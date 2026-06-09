"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
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
  estimatedCost: number | null;
  fundingNote: string | null;
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
  const [estimatedCost, setEstimatedCost] = useState("");
  const [fundingNote, setFundingNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/documents/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description,
          audience,
          status,
          estimatedCost: estimatedCost ? Number(estimatedCost) : null,
          fundingNote,
        }),
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>{t("financing.estimatedCost")}</label>
          <input
            type="number"
            min="0"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>{t("financing.fundingNote")}</label>
          <input
            type="text"
            value={fundingNote}
            onChange={(e) => setFundingNote(e.target.value)}
            placeholder={t("financing.fundingNotePlaceholder")}
            className={inputCls}
          />
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

interface ProjectComment {
  id: string;
  content: string;
  createdAt: string;
  authorName: string | null;
  isMine: boolean;
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
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [comments, setComments] = useState<ProjectComment[] | null>(null);
  const [interest, setInterest] = useState<{
    up: number;
    down: number;
    mine: "up" | "down" | null;
  } | null>(null);
  const [canReact, setCanReact] = useState(false);
  const [canStartVote, setCanStartVote] = useState(false);
  const [editingFin, setEditingFin] = useState(false);
  const [finCost, setFinCost] = useState("");
  const [finNote, setFinNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/documents/projects/${project.id}`);
    if (res.ok) {
      const j = await res.json();
      setDocs(j.documents ?? []);
      setComments(j.comments ?? []);
      setInterest(j.interest ?? null);
      setCanReact(!!j.canReact);
      setCanStartVote(!!j.canStartVote);
    }
  }, [project.id]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && docs === null) {
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
    }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/documents/projects/${project.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setCommentText("");
        await load();
      }
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(commentId: string) {
    const res = await fetch(
      `/api/documents/projects/${project.id}/comments?commentId=${commentId}`,
      { method: "DELETE" }
    );
    if (res.ok) await load();
  }

  async function react(stance: "up" | "down") {
    if (!canReact) return;
    const next = interest?.mine === stance ? null : stance;
    const res = await fetch(`/api/documents/projects/${project.id}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stance: next }),
    });
    if (res.ok) await load();
  }

  function startEditFin() {
    setFinCost(
      project.estimatedCost != null ? String(project.estimatedCost) : ""
    );
    setFinNote(project.fundingNote ?? "");
    setEditingFin(true);
  }

  async function saveFin() {
    const res = await fetch(`/api/documents/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estimatedCost: finCost ? Number(finCost) : null,
        fundingNote: finNote,
      }),
    });
    if (res.ok) {
      setEditingFin(false);
      onChanged();
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
        <div className="px-5 pb-5 space-y-5">
          {(project.estimatedCost != null ||
            project.fundingNote ||
            canManage) && (
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
              {editingFin ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="number"
                    min="0"
                    value={finCost}
                    onChange={(e) => setFinCost(e.target.value)}
                    placeholder={t("financing.estimatedCost")}
                    className="sm:w-44 px-3 py-2 text-sm border border-gray-300 rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={finNote}
                    onChange={(e) => setFinNote(e.target.value)}
                    placeholder={t("financing.fundingNotePlaceholder")}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                  />
                  <button
                    onClick={saveFin}
                    className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    {tCommon("save")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-gray-700 dark:text-gray-200">
                    💰{" "}
                    {project.estimatedCost != null
                      ? project.estimatedCost.toLocaleString()
                      : "—"}
                    {project.fundingNote ? ` · ${project.fundingNote}` : ""}
                  </span>
                  {canManage && (
                    <button
                      onClick={startEditFin}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-300"
                    >
                      {tCommon("edit")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
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

          {interest && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {t("anketa.title")}
                </h4>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t("anketa.disclaimer")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => react("up")}
                  disabled={!canReact}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    interest.mine === "up"
                      ? "bg-green-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
                  } ${!canReact ? "opacity-60 cursor-default" : ""}`}
                >
                  👍 {interest.up}
                </button>
                <button
                  onClick={() => react("down")}
                  disabled={!canReact}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    interest.mine === "down"
                      ? "bg-red-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200"
                  } ${!canReact ? "opacity-60 cursor-default" : ""}`}
                >
                  👎 {interest.down}
                </button>
              </div>
              {canStartVote && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() =>
                      router.push(`/voting/new?projectId=${project.id}`)
                    }
                    className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-300"
                  >
                    {t("anketa.startVote")} →
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2 dark:text-gray-100">
              💬 {t("discussion.title")}
            </h4>
            <div className="space-y-2 mb-3">
              {comments && comments.length > 0 ? (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="bg-gray-50 rounded-lg px-3 py-2 dark:bg-gray-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {c.authorName ?? tCommon("unknown")}
                      </span>
                      {(c.isMine || canManage) && (
                        <button
                          onClick={() => deleteComment(c.id)}
                          className="text-xs text-red-600 hover:underline dark:text-red-400"
                        >
                          {t("discussion.delete")}
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap dark:text-gray-200">
                      {c.content}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("discussion.empty")}
                </p>
              )}
            </div>
            <form onSubmit={postComment} className="flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={t("discussion.placeholder")}
                maxLength={5000}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
              <button
                type="submit"
                disabled={posting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {t("discussion.send")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
