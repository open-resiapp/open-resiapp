"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import DocumentCard, { type DocumentItem } from "./DocumentCard";

// Renders a document Project's title + its documents (read-only, download
// only), given a project id. Used by the voting detail to show the dossier
// behind a vote. BYT-20260608-001 Phase C.

interface ProjectDocsResponse {
  project: { title: string };
  documents: DocumentItem[];
}

export default function ProjectDocsInline({
  projectId,
}: {
  projectId: string;
}) {
  const t = useTranslations("Documents");
  const [data, setData] = useState<ProjectDocsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/documents/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active) setData(j);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading || !data) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        📁 {data.project.title}
      </h3>
      {data.documents.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>
      ) : (
        data.documents.map((d) => (
          <DocumentCard
            key={d.id}
            doc={d}
            canManage={false}
            onDelete={() => {}}
            readOnly
          />
        ))
      )}
    </div>
  );
}
