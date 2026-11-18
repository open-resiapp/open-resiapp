import { Icon, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import type { LawFootnote, LawItem, LawNode, LawParagraph, LawProvision, LawSection } from "@/lib/laws";
import { sectionTitle } from "@/lib/laws-reader";

// Server-rendered law text for the reader. Strings only — the data is plain
// text by construction (scripts/laws-sync.ts strips all markup), and React
// escapes it; nothing is injected as HTML. Copy-link buttons are plain
// <button data-copy-anchor> handled by one delegated listener in
// LawReaderControls, so this tree ships no client JS.

const ANCHOR_TARGET = "scroll-mt-24 rounded-md target:bg-ui-warning/15 target:ring-2 target:ring-ui-warning/40";

type HeadingTag = "h2" | "h3" | "h4";
const headingTag = (depth: number): HeadingTag => (depth <= 0 ? "h2" : depth === 1 ? "h3" : "h4");

export interface LawTextProps {
  nodes: LawNode[];
  /** aria-label of the copy-link button, e.g. "Kopírovať odkaz na § 14". */
  copyLabel: (label: string) => string;
  /** Heading depth of the first level (0 → h2). */
  depth?: number;
}

export function LawText({ nodes, copyLabel, depth = 0 }: LawTextProps) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "section":
            return <Section key={node.anchor} section={node} copyLabel={copyLabel} depth={depth} />;
          case "provision":
            return <Provision key={node.anchor} provision={node} copyLabel={copyLabel} depth={depth} />;
          case "heading": {
            const Tag = headingTag(depth);
            return (
              <Tag
                key={node.anchor}
                id={node.anchor}
                className={cn("mt-10 text-center font-sans text-[1em] font-semibold text-ui-text", ANCHOR_TARGET)}
              >
                {node.text}
              </Tag>
            );
          }
          case "text":
            return (
              <p key={`t${i}`} className="mt-6 whitespace-pre-line text-ui-text-muted">
                {node.text}
              </p>
            );
        }
      })}
    </>
  );
}

function Section({ section, copyLabel, depth }: { section: LawSection; copyLabel: LawTextProps["copyLabel"]; depth: number }) {
  const Tag = headingTag(depth);
  const title = sectionTitle(section);
  return (
    <section id={section.anchor} aria-label={title || undefined} className={cn("mt-10 first:mt-0", ANCHOR_TARGET)}>
      {title ? (
        <Tag className="text-center font-sans font-semibold text-ui-text">
          {section.label ? (
            <span className={cn("block tracking-wide", depth <= 0 ? "text-[1.1em]" : "text-[1em]")}>
              {section.label}
            </span>
          ) : null}
          {section.heading ? (
            <span className={cn("mt-1 block", depth <= 0 ? "text-[1.1em]" : "text-[1em]", section.label && "font-medium")}>
              {section.heading}
            </span>
          ) : null}
        </Tag>
      ) : null}
      <LawText nodes={section.children} copyLabel={copyLabel} depth={depth + 1} />
    </section>
  );
}

function Provision({
  provision,
  copyLabel,
  depth,
}: {
  provision: LawProvision;
  copyLabel: LawTextProps["copyLabel"];
  depth: number;
}) {
  const Tag = headingTag(depth);
  return (
    <article id={provision.anchor} data-law-provision="" className={cn("mt-10 first:mt-0", ANCHOR_TARGET)}>
      <header className="flex items-start gap-2">
        <Tag className="min-w-0 flex-1 pt-2 text-center font-sans font-semibold text-ui-text">
          <span className="block text-[1.05em]">{provision.label}</span>
          {provision.heading ? <span className="mt-1 block text-[1em] font-medium">{provision.heading}</span> : null}
        </Tag>
        {provision.label ? (
          <button
            type="button"
            data-copy-anchor={provision.anchor}
            data-copy-label={provision.label}
            aria-label={copyLabel(provision.label)}
            title={copyLabel(provision.label)}
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ui-text-muted hover:bg-ui-surface-muted hover:text-ui-text",
              focusRing,
            )}
          >
            <Icon name="link" size={20} />
          </button>
        ) : null}
      </header>
      {provision.paragraphs.map((p) => (
        <Paragraph key={p.anchor} paragraph={p} />
      ))}
    </article>
  );
}

function Paragraph({ paragraph }: { paragraph: LawParagraph }) {
  return (
    <div id={paragraph.anchor} className={cn("mt-4", ANCHOR_TARGET)}>
      {paragraph.text || paragraph.n ? (
        <p className="whitespace-pre-line">
          {paragraph.n ? <span className="font-sans font-semibold">({paragraph.n})&nbsp;</span> : null}
          {paragraph.text}
        </p>
      ) : null}
      {paragraph.items ? <Items items={paragraph.items} /> : null}
      {paragraph.tail ? <p className="mt-2 whitespace-pre-line">{paragraph.tail}</p> : null}
    </div>
  );
}

function Items({ items }: { items: LawItem[] }) {
  return (
    <ol className="mt-2 list-none space-y-1.5 pl-3 sm:pl-6">
      {items.map((item) => (
        <li key={item.anchor} id={item.anchor} className={cn("flex gap-2", ANCHOR_TARGET)}>
          {item.label ? <span className="shrink-0 font-sans font-medium">{item.label}</span> : null}
          <div className="min-w-0 flex-1">
            {item.text ? <p className="whitespace-pre-line">{item.text}</p> : null}
            {item.items ? <Items items={item.items} /> : null}
            {item.tail ? <p className="mt-1 whitespace-pre-line">{item.tail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function LawFootnotes({ footnotes, title }: { footnotes: LawFootnote[]; title: string }) {
  if (!footnotes.length) return null;
  return (
    <section aria-label={title} className="mt-12 border-t border-ui-border pt-6 text-[0.9em]">
      <h2 className="font-sans font-semibold text-ui-text">{title}</h2>
      <ol className="mt-3 list-none space-y-2">
        {footnotes.map((f) => (
          <li key={f.anchor} id={f.anchor} className={cn("flex gap-2", ANCHOR_TARGET)}>
            <span className="shrink-0 font-sans font-medium">{f.label}</span>
            <p className="min-w-0 flex-1 whitespace-pre-line">{f.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
