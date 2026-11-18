"use client";

import { useEffect, useState } from "react";

import { ButtonLink } from "@/components/ui";
import { readProgress, type LawProgressEntry } from "@/lib/laws-progress";

// "Continue where you left off" on /zakony: offers the most recently read
// law as a button (never redirects). Renders nothing without storage.

export function ContinueReading({
  laws,
  labels,
}: {
  laws: { id: string; title: string; number: string }[];
  labels: { button: string; hint: string }; // hint contains "{title}"
}) {
  const [last, setLast] = useState<{ id: string; entry: LawProgressEntry } | null>(null);

  useEffect(() => {
    const progress = readProgress();
    const known = new Set(laws.map((l) => l.id));
    const latest = Object.entries(progress)
      .filter(([id]) => known.has(id))
      .sort((a, b) => b[1].at - a[1].at)[0];
    if (latest) setLast({ id: latest[0], entry: latest[1] });
  }, [laws]);

  if (!last) return null;
  const law = laws.find((l) => l.id === last.id);
  if (!law) return null;

  const href = last.entry.anchor
    ? `/zakony/${law.id}/p/${encodeURIComponent(last.entry.anchor)}`
    : `/zakony/${law.id}?kapitola=${last.entry.chapter}`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ui-border bg-ui-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-base text-ui-text break-words">
        {labels.hint.replace("{title}", `${law.number} ${law.title}`)}
      </p>
      <ButtonLink href={href} variant="secondary" className="shrink-0">
        {labels.button}
      </ButtonLink>
    </div>
  );
}
