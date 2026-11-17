import { getFormatter, getTranslations } from "next-intl/server";

import { Badge, Card, Icon, cn } from "@/components/ui";
import { focusRing } from "@/components/ui/cn";
import { Link } from "@/i18n/navigation";
import type { NoticeRow } from "@/lib/notice-board.server";

import { formatDate } from "./format";

// Compact teaser of the latest notices (title, date, two lines of text).
// Not a PostCard: the home shows teasers only and must not fire the
// per-post attachments fetch PostCard does — the full post lives on /board.

export async function NoticeList({ notices }: { notices: NoticeRow[] }) {
  const t = await getTranslations("Home.notices");
  const format = await getFormatter();

  if (notices.length === 0) {
    return (
      <Card>
        <p className="text-base text-ui-text-muted">{t("empty")}</p>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {notices.map((n) => (
        <li key={n.id}>
          <Link
            href="/board"
            className={cn(
              "block rounded-xl border border-ui-border bg-ui-surface px-4 py-3 text-ui-text transition-colors hover:border-ui-border-strong hover:bg-ui-surface-muted",
              focusRing
            )}
          >
            <span className="flex flex-wrap items-center gap-2">
              {n.isPinned ? (
                <Badge tone="info">
                  <Icon name="bell" size={16} />
                  {t("pinned")}
                </Badge>
              ) : null}
              {n.category === "urgent" ? <Badge tone="danger">{t("urgent")}</Badge> : null}
              <span className="text-base text-ui-text-muted">{formatDate(format, n.createdAt)}</span>
            </span>
            <span className="mt-1 block text-lg font-semibold break-words">{n.title}</span>
            <span className="mt-1 line-clamp-2 block text-base text-ui-text-muted break-words">
              {n.content}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
