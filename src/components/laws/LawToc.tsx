import { cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";
import type { LawChapter } from "@/lib/laws-reader";

// Table of contents for the reader: every chapter, and the § of the current
// chapter. Server component — rendered in the desktop sidebar and in the
// mobile <details> sheet.

export function chapterLabel(chapter: LawChapter, labels: { wholeAct: string; footnotes: string }): string {
  if (chapter.kind === "footnotes") return labels.footnotes;
  return chapter.title || labels.wholeAct;
}

export function LawToc({
  lawId,
  chapters,
  current,
  labels,
}: {
  lawId: string;
  chapters: LawChapter[];
  current: number;
  labels: { wholeAct: string; footnotes: string; tocLabel: string };
}) {
  const linkClass = (active: boolean) =>
    cn(
      "block rounded-md px-2 py-1.5 text-base leading-snug break-words",
      active ? "bg-ui-surface-muted font-semibold text-ui-text" : "text-ui-text-muted hover:bg-ui-surface-muted hover:text-ui-text",
      focusRing,
    );

  return (
    <nav aria-label={labels.tocLabel}>
      <ol className="space-y-0.5">
        {chapters.map((ch, i) => {
          const group = ch.trail[ch.trail.length - 1];
          const prevGroup = i > 0 ? chapters[i - 1].trail[chapters[i - 1].trail.length - 1] : undefined;
          const active = ch.index === current;
          return (
            <li key={ch.index}>
              {group && group !== prevGroup ? (
                <p className="mt-3 px-2 pb-1 text-sm font-semibold tracking-wide text-ui-text-muted">{group}</p>
              ) : null}
              <Link
                href={`/zakony/${lawId}?kapitola=${ch.index}`}
                aria-current={active ? "page" : undefined}
                className={linkClass(active)}
              >
                {chapterLabel(ch, labels)}
              </Link>
              {active && ch.provisions.length ? (
                <ol className="mb-2 ml-2 mt-1 space-y-0.5 border-l border-ui-border pl-2">
                  {ch.provisions.map((p) => (
                    <li key={p.anchor}>
                      <a href={`#${p.anchor}`} className={cn(linkClass(false), "py-1 text-sm")}>
                        <span className="font-medium text-ui-text">{p.label}</span>
                        {p.heading ? <span> · {p.heading}</span> : null}
                      </a>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
