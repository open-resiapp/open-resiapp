"use client";

import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { DocumentType, DocumentAudience } from "@/lib/documents";
import { Badge, Button, Icon } from "@/components/ui";
import DocumentVisibilityDialog from "./DocumentVisibilityDialog";
import DocumentAuditDialog from "./DocumentAuditDialog";
import DocumentSendDialog from "./DocumentSendDialog";

// Bespoke card — justified per CLAUDE.md UI rule: a document item models file
// download + audience tier + legal retention, semantics orthogonal to
// PostCard's post/category/pin shape. Reusing PostCard would mean gutting it.

export interface DocumentItem {
  id: string;
  name: string;
  type: DocumentType;
  audience: DocumentAudience;
  mimeType: string | null;
  sizeBytes: number | null;
  originalName: string | null;
  retainUntil: string | null;
  createdAt: string;
  uploaderName: string | null;
  isUploader: boolean;
  projectId: string | null;
  // Owner folder (BYT-20261118-005). subject* only populated for the board.
  isMine?: boolean;
  subjectUserId?: string | null;
  subjectName?: string | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} kB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const AUDIENCE_STYLES: Record<DocumentAudience, string> = {
  admin: "bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
  owner: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
  resident:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
};

export default function DocumentCard({
  doc,
  canManage,
  onDelete,
  projects,
  onAssignProject,
  readOnly,
  onChanged,
  highlighted,
}: {
  doc: DocumentItem;
  canManage: boolean;
  onDelete: (id: string) => void;
  projects?: { id: string; title: string }[];
  onAssignProject?: (id: string, projectId: string | null) => void;
  readOnly?: boolean;
  /** Board actions (visibility / history / e-mail) refresh the list via this. */
  onChanged?: () => void;
  highlighted?: boolean;
}) {
  const t = useTranslations("Documents");
  const tv = useTranslations("DocumentVisibility");
  const [dialog, setDialog] = useState<"visibility" | "history" | "send" | null>(
    null
  );
  const boardActions = !readOnly && canManage && !!onChanged;
  const format = useFormatter();
  const canDelete = !readOnly && (canManage || doc.isUploader);

  const meta = [
    doc.uploaderName ? t("uploadedBy", { name: doc.uploaderName }) : null,
    format.dateTime(new Date(doc.createdAt), { dateStyle: "medium" }),
    formatBytes(doc.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      id={`doc-${doc.id}`}
      className={`bg-white rounded-2xl shadow-sm p-5 flex flex-wrap items-start gap-4 dark:bg-gray-800 dark:shadow-black/40 ${
        highlighted ? "ring-2 ring-ui-focus" : ""
      }`}
    >
      <div className="text-3xl shrink-0" aria-hidden>
        📄
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
            {t(`type.${doc.type}`)}
          </span>
          {doc.audience === "admin" ? (
            // "Len výbor" — icon WITH text (senior baseline).
            <Badge tone="danger">
              <Icon name="key" size={16} />
              {tv("chip.boardOnly")}
            </Badge>
          ) : (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${AUDIENCE_STYLES[doc.audience]}`}
            >
              {t(`audience.${doc.audience}`)}
            </span>
          )}
          {doc.subjectName && (
            <Badge tone="info">
              <Icon name="user" size={16} />
              {doc.audience === "admin"
                ? tv("chip.about", { name: doc.subjectName })
                : tv("chip.ownerSees", { name: doc.subjectName })}
            </Badge>
          )}
          {!doc.subjectName && doc.isMine && (
            <Badge tone="info">
              <Icon name="user" size={16} />
              {tv("chip.mine")}
            </Badge>
          )}
        </div>
        <h3 className="text-base font-semibold text-gray-900 mt-2 truncate dark:text-gray-100">
          {doc.name}
        </h3>
        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">{meta}</p>
        {doc.retainUntil && (
          <p className="text-xs text-gray-400 mt-1 dark:text-gray-500">
            {t("retainUntilLabel", { date: doc.retainUntil })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        {/* Plain <a> (not next-intl Link): API route, must not be locale-prefixed. */}
        <a
          href={`/api/documents/${doc.id}`}
          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg text-center"
        >
          {t("download")}
        </a>
        {canDelete && (
          <button
            onClick={() => onDelete(doc.id)}
            className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg dark:text-red-400 dark:hover:bg-red-900/30"
          >
            {t("delete")}
          </button>
        )}
        {!readOnly && canManage && projects && onAssignProject && (
          <select
            value={doc.projectId ?? ""}
            onChange={(e) => onAssignProject(doc.id, e.target.value || null)}
            className="px-2 py-1 text-xs border border-gray-300 rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            title={t("assignProject")}
          >
            <option value="">{t("noProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {boardActions && (
        <div className="basis-full flex flex-wrap gap-2 border-t border-ui-border pt-3">
          <Button variant="ghost" onClick={() => setDialog("visibility")}>
            <Icon name="users" size={20} />
            {tv("actions.visibility")}
          </Button>
          <Button variant="ghost" onClick={() => setDialog("history")}>
            <Icon name="clock" size={20} />
            {tv("actions.history")}
          </Button>
          <Button variant="ghost" onClick={() => setDialog("send")}>
            <Icon name="mail" size={20} />
            {tv("actions.send")}
          </Button>
        </div>
      )}
      {boardActions && dialog === "visibility" && (
        <DocumentVisibilityDialog
          open
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged?.();
          }}
          documentId={doc.id}
          audience={doc.audience}
          subjectUserId={doc.subjectUserId ?? null}
          subjectName={doc.subjectName ?? null}
        />
      )}
      {boardActions && dialog === "history" && (
        <DocumentAuditDialog open onClose={() => setDialog(null)} documentId={doc.id} />
      )}
      {boardActions && dialog === "send" && (
        <DocumentSendDialog
          open
          onClose={() => setDialog(null)}
          onSent={() => onChanged?.()}
          onMakeVisible={() => setDialog("visibility")}
          documentId={doc.id}
        />
      )}
    </div>
  );
}
