"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Badge, Card, Icon, cn } from "@/components/ui";
import type { FeedAttachment } from "@/lib/feed";
import type { PostCategory } from "@/types";

// The ONE post card for the whole app (CLAUDE.md "reuse shared card
// components"): board notices, events, help and sale/gift posts all render
// through it. Type-specific parts are injected:
//   - `category` (notices) → official badge + urgency/maintenance badge
//   - `badges`   → extra type badges (event, help offer/request, sale …)
//   - `meta`     → block under the title (event date/place, price)
//   - `actions`  → owner/moderator overflow menu (ActionMenu)
//   - `children` → footer (RSVP buttons, responses)

export interface PostCardProps {
  /** DOM id (deep-link anchor). */
  anchorId?: string;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
  /** Board notice category — marks the card as an official notice. */
  category?: PostCategory;
  isPinned?: boolean;
  entranceName?: string | null;
  badges?: ReactNode;
  meta?: ReactNode;
  photoUrl?: string | null;
  attachments?: FeedAttachment[];
  /** Resolved / expired / past: dimmed. */
  muted?: boolean;
  highlighted?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

export default function PostCard({
  anchorId,
  title,
  content,
  authorName,
  createdAt,
  category,
  isPinned = false,
  entranceName,
  badges,
  meta,
  photoUrl,
  attachments,
  muted = false,
  highlighted = false,
  actions,
  children,
}: PostCardProps) {
  const t = useTranslations("Feed");
  const format = useFormatter();
  const isNotice = category !== undefined;
  const urgent = category === "urgent";

  return (
    <Card
      as="article"
      padding="lg"
      id={anchorId}
      aria-labelledby={anchorId ? `${anchorId}-title` : undefined}
      className={cn(
        "scroll-mt-24",
        urgent && "border-ui-danger/50",
        !urgent && isPinned && "border-ui-primary/50",
        highlighted && "ring-2 ring-ui-focus",
        muted && "opacity-75",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isNotice ? (
            <Badge tone="info">
              <Icon name="megaphone" size={16} />
              {t("badge.official")}
            </Badge>
          ) : null}
          {urgent ? (
            <Badge tone="danger">
              <Icon name="alert" size={16} />
              {t("badge.urgent")}
            </Badge>
          ) : null}
          {category === "maintenance" ? <Badge tone="warning">{t("badge.maintenance")}</Badge> : null}
          {category === "event" ? <Badge tone="neutral">{t("badge.event")}</Badge> : null}
          {isPinned ? <Badge tone="neutral">{t("badge.pinned")}</Badge> : null}
          {badges}
          {entranceName ? <Badge tone="neutral">{entranceName}</Badge> : null}
        </div>
        {actions ? <div className="-mr-2 -mt-2 shrink-0">{actions}</div> : null}
      </div>

      <h3
        id={anchorId ? `${anchorId}-title` : undefined}
        className="mb-2 text-lg font-semibold text-ui-text break-words"
      >
        {title}
      </h3>

      {meta ? <div className="mb-3">{meta}</div> : null}

      {content ? (
        <p className="mb-3 whitespace-pre-wrap text-base text-ui-text break-words">{content}</p>
      ) : null}

      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={title}
          className="mb-3 max-h-80 w-auto max-w-full rounded-lg object-cover"
        />
      ) : null}

      {attachments && attachments.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-2" aria-label={t("card.attachments")}>
          {attachments.map((d) => (
            <li key={d.id}>
              <a
                href={`/api/documents/${d.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-ui-border bg-ui-surface-muted px-3 text-base text-ui-text hover:border-ui-border-strong"
              >
                <Icon name="file" size={20} />
                <span className="break-all">{d.name}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-base text-ui-text-muted">
        <span>{authorName}</span>
        <time dateTime={createdAt}>
          {format.dateTime(new Date(createdAt), { day: "numeric", month: "long", year: "numeric" })}
        </time>
      </div>

      {children ? <div className="mt-4 border-t border-ui-border pt-4">{children}</div> : null}
    </Card>
  );
}
