"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";

import ResponseList, { type CommunityResponse } from "@/components/community/ResponseList";
import ResponseModal from "@/components/community/ResponseModal";
import {
  ActionMenu,
  Badge,
  Button,
  ConfirmProvider,
  Icon,
  useConfirm,
  type ActionMenuItem,
} from "@/components/ui";
import { useRouter } from "@/i18n/navigation";
import {
  splitPrice,
  type FeedCommunityPost,
  type FeedItem,
  type FeedNotice,
  type RsvpStatus,
} from "@/lib/feed";
import MeetingRsvpButtons from "@/components/community/MeetingRsvpButtons";
import EditPostModal from "./EditPostModal";
import PostCard from "./PostCard";

export interface FeedViewerCaps {
  userId: string;
  /** Edit / pin / delete own board notices (`createPost`). */
  canManageNotices: boolean;
  /** …and other people's notices too: admin or an active board role (caretaker: own only). */
  canManageAllNotices: boolean;
  /** Moderate any community post (`moderateCommunityResponse`, admin). */
  canModerate: boolean;
  /** Respond + RSVP (`respondToCommunityPost`). */
  canRespond: boolean;
}

export default function FeedList(props: {
  items: FeedItem[];
  viewer: FeedViewerCaps;
  highlightKey?: string;
}) {
  return (
    <ConfirmProvider>
      <FeedListInner {...props} />
    </ConfirmProvider>
  );
}

function FeedListInner({
  items,
  viewer,
  highlightKey,
}: {
  items: FeedItem[];
  viewer: FeedViewerCaps;
  highlightKey?: string;
}) {
  const t = useTranslations("Feed");
  const router = useRouter();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<FeedNotice | null>(null);
  const [respondTo, setRespondTo] = useState<FeedCommunityPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Expanded response threads (fetched on demand, user-initiated).
  const [threads, setThreads] = useState<Record<string, CommunityResponse[] | "loading">>({});

  const refresh = () => startTransition(() => router.refresh());

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    const res = await fetch(url, init).catch(() => null);
    if (!res?.ok) {
      setError(t("error"));
      return false;
    }
    refresh();
    return true;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  async function loadThread(id: string) {
    setThreads((s) => ({ ...s, [id]: "loading" }));
    const res = await fetch(`/api/community/posts/${id}`).catch(() => null);
    if (!res?.ok) {
      setThreads((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
      setError(t("responses.loadFailed"));
      return;
    }
    const body = (await res.json()) as { responses?: CommunityResponse[] };
    setThreads((s) => ({ ...s, [id]: body.responses ?? [] }));
  }

  function toggleThread(id: string) {
    if (threads[id]) {
      setThreads((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    } else {
      void loadThread(id);
    }
  }

  async function respond(content: string): Promise<boolean> {
    if (!respondTo) return false;
    const id = respondTo.id;
    const ok = await call(`/api/community/posts/${id}/respond`, json("POST", { content }));
    if (ok && threads[id]) void loadThread(id);
    return ok;
  }

  function noticeActions(n: FeedNotice): ActionMenuItem[] {
    if (!viewer.canManageNotices) return [];
    // Same rule as /api/posts/[id]: caretakers manage only their own notices.
    if (!viewer.canManageAllNotices && n.author?.id !== viewer.userId) return [];
    return [
      { label: t("actions.edit"), onSelect: () => setEditing(n) },
      {
        label: n.isPinned ? t("actions.unpin") : t("actions.pin"),
        onSelect: () => void call(`/api/posts/${n.id}`, json("PATCH", { isPinned: !n.isPinned })),
      },
      {
        label: t("actions.delete"),
        tone: "danger",
        onSelect: async () => {
          const ok = await confirm({
            title: t("confirm.deleteTitle"),
            description: t("confirm.deleteNotice", { title: n.title }),
            confirmLabel: t("confirm.deleteConfirm"),
            tone: "danger",
          });
          if (ok) void call(`/api/posts/${n.id}`, { method: "DELETE" });
        },
      },
    ];
  }

  function communityActions(c: FeedCommunityPost): ActionMenuItem[] {
    const isAuthor = c.author?.id === viewer.userId;
    if (!isAuthor && !viewer.canModerate) return [];
    const items: ActionMenuItem[] = [];
    if (c.status === "active" && c.type !== "event") {
      items.push({
        label: t("actions.resolve"),
        onSelect: async () => {
          const ok = await confirm({
            title: t("confirm.resolveTitle"),
            description: t("confirm.resolveText"),
            confirmLabel: t("confirm.resolveConfirm"),
          });
          if (ok) void call(`/api/community/posts/${c.id}`, json("PATCH", { status: "resolved" }));
        },
      });
    }
    items.push({
      label: c.responsesAllowed ? t("actions.disableResponses") : t("actions.enableResponses"),
      onSelect: () =>
        void call(`/api/community/posts/${c.id}`, json("PATCH", { responsesAllowed: !c.responsesAllowed })),
    });
    items.push({
      label: t("actions.delete"),
      tone: "danger",
      onSelect: async () => {
        const ok = await confirm({
          title: t("confirm.deleteTitle"),
          description: t("confirm.deleteCommunity", { title: c.title }),
          confirmLabel: t("confirm.deleteConfirm"),
          tone: "danger",
        });
        if (ok) void call(`/api/community/posts/${c.id}`, { method: "DELETE" });
      },
    });
    return items;
  }

  function menu(item: FeedItem, actions: ActionMenuItem[]) {
    return actions.length > 0 ? (
      <ActionMenu label={t("card.actionsFor", { title: item.title })} items={actions} />
    ) : undefined;
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-ui-danger/40 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger">
          {error}
        </p>
      ) : null}

      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.key}>
            {item.kind === "notice" ? (
              <PostCard
                anchorId={item.key}
                title={item.title}
                content={item.content}
                category={item.category}
                isPinned={item.isPinned}
                entranceName={item.entranceName}
                authorName={item.author?.name || "—"}
                createdAt={item.createdAt}
                attachments={item.attachments}
                highlighted={item.key === highlightKey}
                actions={menu(item, noticeActions(item))}
              />
            ) : (
              <CommunityCard
                post={item}
                viewer={viewer}
                highlighted={item.key === highlightKey}
                actions={menu(item, communityActions(item))}
                thread={threads[item.id]}
                onToggleThread={() => toggleThread(item.id)}
                onRespond={() => setRespondTo(item)}
                onRsvp={(status) =>
                  void call(`/api/community/posts/${item.id}/rsvp`, json("POST", { status }))
                }
                onRsvpWithdraw={() =>
                  void call(`/api/community/posts/${item.id}/rsvp`, { method: "DELETE" })
                }
              />
            )}
          </li>
        ))}
      </ul>

      {editing ? (
        <EditPostModal post={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      ) : null}

      <ResponseModal
        open={respondTo !== null}
        postTitle={respondTo?.title}
        onClose={() => setRespondTo(null)}
        onSubmit={respond}
      />
    </>
  );
}

// ── Community post → shared PostCard with type-specific children ──

function CommunityCard({
  post,
  viewer,
  highlighted,
  actions,
  thread,
  onToggleThread,
  onRespond,
  onRsvp,
  onRsvpWithdraw,
}: {
  post: FeedCommunityPost;
  viewer: FeedViewerCaps;
  highlighted: boolean;
  actions?: React.ReactNode;
  thread: CommunityResponse[] | "loading" | undefined;
  onToggleThread: () => void;
  onRespond: () => void;
  onRsvp: (s: RsvpStatus) => void;
  onRsvpWithdraw: () => void;
}) {
  const t = useTranslations("Feed");
  const tMeeting = useTranslations("MeetingAttendance.rsvp");
  const format = useFormatter();
  const isAuthor = post.author?.id === viewer.userId;
  const isEvent = post.type === "event";
  const isPast = isEvent && !!post.eventDate && new Date(post.eventDate).getTime() < Date.now();
  const { body, price } = post.type === "sale" ? splitPrice(post.content) : { body: post.content, price: null };
  // Events created without text repeat the title as content (API requires it).
  const content = isEvent && body.trim() === post.title.trim() ? "" : body;

  const badges = (
    <>
      <TypeBadge type={post.type} />
      {post.eventKind === "owners_meeting" ? <Badge tone="warning">{tMeeting("badge")}</Badge> : null}
      {post.status !== "active" ? <Badge tone="neutral">{t(`badge.${post.status}`)}</Badge> : null}
      {post.status === "active" && isPast ? <Badge tone="neutral">{t("badge.past")}</Badge> : null}
    </>
  );

  let meta: React.ReactNode = null;
  if (isEvent && post.eventDate) {
    meta = (
      <div className="grid gap-1 text-base text-ui-text">
        <p className="flex items-start gap-2 font-medium">
          <Icon name="calendar" size={20} className="mt-0.5 shrink-0 text-ui-text-muted" />
          <span>
            <span className="sr-only">{t("card.when")}: </span>
            {format.dateTime(new Date(post.eventDate), {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </p>
        {post.eventLocation ? (
          <p className="flex items-start gap-2">
            <Icon name="building" size={20} className="mt-0.5 shrink-0 text-ui-text-muted" />
            <span>
              <span className="sr-only">{t("card.where")}: </span>
              {post.eventLocation}
            </span>
          </p>
        ) : null}
      </div>
    );
  } else if (post.type === "sale" || post.type === "free") {
    meta = (
      <p className="text-lg font-semibold text-ui-text">
        {post.type === "free" ? t("card.free") : price ? `${t("card.price")}: ${price}` : null}
      </p>
    );
  }

  const canRespondHere = viewer.canRespond && !isAuthor && post.status === "active" && post.responsesAllowed;
  const respondLabel =
    post.type === "help_request"
      ? t("responses.willHelp")
      : isEvent
        ? t("responses.comment")
        : t("responses.interested");

  return (
    <PostCard
      anchorId={post.key}
      title={post.title}
      content={content}
      authorName={post.author?.name || "—"}
      createdAt={post.createdAt}
      entranceName={post.entranceName}
      badges={badges}
      meta={meta}
      photoUrl={post.photoUrl}
      attachments={post.attachments}
      muted={post.status !== "active" || isPast}
      highlighted={highlighted}
      actions={actions}
    >
      <div className="space-y-4">
        {isEvent && post.rsvp && post.eventKind === "owners_meeting" ? (
          // BYT-20261118-001: owners' meeting — three explicit answers +
          // withdraw; counts only, never names (§9). Eligibility is checked
          // server-side (MEETING_RSVP_NOT_ELIGIBLE).
          <div className="space-y-3">
            <p className="text-base text-ui-text-muted">
              {tMeeting("counts", { yes: post.rsvp.yes, maybe: post.rsvp.maybe, no: post.rsvp.no })}
            </p>
            {viewer.canRespond ? (
              <MeetingRsvpButtons
                value={post.rsvp.myRsvp}
                readOnly={isPast || post.status !== "active"}
                onSelect={onRsvp}
                onWithdraw={onRsvpWithdraw}
              />
            ) : null}
          </div>
        ) : isEvent && post.rsvp ? (
          <div className="space-y-3">
            <p className="text-base text-ui-text-muted">
              {t("rsvp.counts", { yes: post.rsvp.yes, maybe: post.rsvp.maybe, no: post.rsvp.no })}
            </p>
            {!isPast && viewer.canRespond && post.status === "active" ? (
              <fieldset>
                <legend className="mb-2 text-base font-medium text-ui-text">{t("rsvp.label")}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["yes", "maybe", "no"] as const).map((s) => {
                    const active = post.rsvp?.myRsvp === s;
                    return (
                      <Button
                        key={s}
                        variant="secondary"
                        aria-pressed={active}
                        onClick={() => onRsvp(s)}
                        className={
                          active ? "border-ui-primary bg-ui-surface-muted ring-2 ring-ui-primary" : undefined
                        }
                      >
                        {active ? <Icon name="check" size={18} /> : null}
                        {t(`rsvp.${s}`)}
                      </Button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {post.responseCount > 0 ? (
            <Button variant="ghost" onClick={onToggleThread} aria-expanded={!!thread}>
              <Icon name={thread ? "chevronDown" : "chevronRight"} size={20} />
              {thread ? t("responses.hide") : t("responses.show", { count: post.responseCount })}
            </Button>
          ) : (
            <span className="text-base text-ui-text-muted">{t("responses.none")}</span>
          )}
          {canRespondHere ? (
            <Button variant="secondary" onClick={onRespond}>
              {respondLabel}
            </Button>
          ) : !post.responsesAllowed ? (
            <span className="text-base text-ui-text-muted">{t("responses.disabled")}</span>
          ) : null}
        </div>

        {thread === "loading" ? (
          <p className="text-base text-ui-text-muted">{t("responses.loading")}</p>
        ) : thread ? (
          <ResponseList responses={thread} />
        ) : null}
      </div>
    </PostCard>
  );
}

function TypeBadge({ type }: { type: FeedCommunityPost["type"] }) {
  const t = useTranslations("Feed.badge");
  switch (type) {
    case "event":
      return (
        <Badge tone="info">
          <Icon name="calendar" size={16} />
          {t("event")}
        </Badge>
      );
    case "help_offer":
      return (
        <Badge tone="success">
          <Icon name="heart" size={16} />
          {t("helpOffer")}
        </Badge>
      );
    case "help_request":
      return (
        <Badge tone="warning">
          <Icon name="help" size={16} />
          {t("helpRequest")}
        </Badge>
      );
    case "sale":
      return <Badge tone="neutral">{t("sale")}</Badge>;
    case "free":
      return <Badge tone="success">{t("free")}</Badge>;
    case "borrow":
      return <Badge tone="neutral">{t("borrow")}</Badge>;
  }
}
