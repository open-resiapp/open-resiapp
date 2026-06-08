"use client";

import { useEffect, useState } from "react";

// Read-only render of the documents attached to a post — download chips.
// Lazily fetches /api/document-links. Returns null when there are none.
// BYT-20260608-001 Phase B.
export default function PostAttachments({
  targetType,
  targetId,
}: {
  targetType: "board_post" | "community_post";
  targetId: string;
}) {
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`/api/document-links?targetType=${targetType}&targetId=${targetId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.documents) {
          setDocs(
            j.documents.map((d: { id: string; name: string }) => ({
              id: d.id,
              name: d.name,
            }))
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [targetType, targetId]);

  if (docs.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {docs.map((d) => (
        <a
          key={d.id}
          href={`/api/documents/${d.id}`}
          className="inline-flex items-center gap-1 text-sm px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-200"
        >
          📎 {d.name}
        </a>
      ))}
    </div>
  );
}
