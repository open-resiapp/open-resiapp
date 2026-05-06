"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PostCard, {
  type CommunityPostType,
  type CommunityPostStatus,
} from "@/components/community/PostCard";
import ResponseModal from "@/components/community/ResponseModal";
import ResponseList, {
  type CommunityResponse,
} from "@/components/community/ResponseList";
import type { UserRole } from "@/types";

type RsvpStatus = "yes" | "no" | "maybe";

interface PostData {
  id: string;
  type: CommunityPostType;
  status: CommunityPostStatus;
  title: string;
  content: string;
  photoUrl: string | null;
  eventDate: string | null;
  eventLocation: string | null;
  entranceId: string | null;
  entranceName: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string } | null;
  rsvp?: {
    yes: number;
    maybe: number;
    no: number;
    myRsvp: RsvpStatus | null;
  };
  responseCount?: number;
}

type TabValue = "upcoming" | "past";

export default function EventsPage() {
  const { data: session } = useSession();
  const t = useTranslations("Community");
  const tEvents = useTranslations("Community.events");
  const tCommon = useTranslations("Common");
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabValue>("upcoming");
  const [respondTo, setRespondTo] = useState<PostData | null>(null);
  const [expanded, setExpanded] = useState<Record<string, CommunityResponse[] | "loading" | undefined>>({});

  async function toggleResponses(postId: string) {
    const current = expanded[postId];
    if (current && current !== "loading") {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      return;
    }
    setExpanded((prev) => ({ ...prev, [postId]: "loading" }));
    try {
      const res = await fetch(`/api/community/posts/${postId}`);
      if (!res.ok) {
        setExpanded((prev) => {
          const next = { ...prev };
          delete next[postId];
          return next;
        });
        return;
      }
      const body = (await res.json()) as { responses?: CommunityResponse[] };
      setExpanded((prev) => ({ ...prev, [postId]: body.responses ?? [] }));
    } catch {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }
  }

  async function handleRespond(content: string) {
    if (!respondTo) return;
    const res = await fetch(`/api/community/posts/${respondTo.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      // Refresh expanded responses if open and refetch the list to bump
      // the response count.
      const postId = respondTo.id;
      if (expanded[postId]) {
        setExpanded((prev) => ({ ...prev, [postId]: undefined }));
        await toggleResponses(postId);
      }
      fetchPosts();
      setRespondTo(null);
    }
  }

  const role = (session?.user?.role || "owner") as UserRole;
  const userId = session?.user?.id;
  const isAdmin = role === "admin";

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("type", "event");
    if (tab === "past") {
      params.set("includeResolved", "true");
      params.set("includeExpired", "true");
    }
    try {
      const res = await fetch(`/api/community/posts?${params.toString()}`);
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return posts.filter((p) => {
      if (!p.eventDate) return false;
      const ts = new Date(p.eventDate).getTime();
      return tab === "upcoming" ? ts >= now : ts < now;
    });
  }, [posts, tab]);

  async function handleRsvp(post: PostData, status: RsvpStatus) {
    const res = await fetch(`/api/community/posts/${post.id}/rsvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) fetchPosts();
  }

  async function handleDelete(post: PostData) {
    if (!confirm(tEvents("confirmDelete"))) return;
    const res = await fetch(`/api/community/posts/${post.id}`, {
      method: "DELETE",
    });
    if (res.ok) fetchPosts();
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-gray-500 mb-1 dark:text-gray-400">
            <Link href="/komunita" className="hover:underline">
              {t("landing.title")}
            </Link>
            {" / "}
            <span>{tEvents("title")}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{tEvents("title")}</h1>
          <p className="text-base text-gray-600 mt-1 dark:text-gray-300">{tEvents("subtitle")}</p>
        </div>
        <Link
          href="/komunita/udalosti/nova"
          className="px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          {tEvents("newEvent")}
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setTab("upcoming")}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            tab === "upcoming"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          {tEvents("tabs.upcoming")}
        </button>
        <button
          onClick={() => setTab("past")}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            tab === "past"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          {tEvents("tabs.past")}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">{tCommon("loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center dark:bg-gray-800 dark:border-gray-700">
          <p className="text-gray-600 mb-4 dark:text-gray-300">{tEvents("empty")}</p>
          {tab === "upcoming" && (
            <Link
              href="/komunita/udalosti/nova"
              className="inline-block px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              {tEvents("newEvent")}
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((post) => {
            const isAuthor = post.author?.id === userId;
            const canManage = isAuthor || isAdmin;
            const rsvp = post.rsvp || { yes: 0, maybe: 0, no: 0, myRsvp: null };
            const isUpcoming = tab === "upcoming";
            return (
              <PostCard
                key={post.id}
                id={post.id}
                type={post.type}
                status={post.status}
                title={post.title}
                content={post.content}
                photoUrl={post.photoUrl}
                eventDate={post.eventDate}
                eventLocation={post.eventLocation}
                authorName={post.author?.name || "—"}
                createdAt={post.createdAt}
                entranceName={post.entranceName}
                canManage={canManage}
                onDelete={canManage ? () => handleDelete(post) : undefined}
              >
                <div className="space-y-3">
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    {tEvents("counts", {
                      yes: rsvp.yes,
                      maybe: rsvp.maybe,
                      no: rsvp.no,
                    })}
                  </div>
                  {isUpcoming && (
                    <div className="grid grid-cols-3 gap-2">
                      <RsvpButton
                        active={rsvp.myRsvp === "yes"}
                        label={tEvents("rsvp.yes")}
                        tone="green"
                        onClick={() => handleRsvp(post, "yes")}
                      />
                      <RsvpButton
                        active={rsvp.myRsvp === "maybe"}
                        label={tEvents("rsvp.maybe")}
                        tone="yellow"
                        onClick={() => handleRsvp(post, "maybe")}
                      />
                      <RsvpButton
                        active={rsvp.myRsvp === "no"}
                        label={tEvents("rsvp.no")}
                        tone="gray"
                        onClick={() => handleRsvp(post, "no")}
                      />
                    </div>
                  )}
                  <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-3 dark:border-gray-700">
                    {(post.responseCount ?? 0) > 0 ? (
                      <button
                        onClick={() => toggleResponses(post.id)}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {expanded[post.id]
                          ? t("hideResponses")
                          : t("showResponses", { count: post.responseCount ?? 0 })}
                      </button>
                    ) : (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {t("noResponses")}
                      </span>
                    )}
                    {!isAuthor && (
                      <button
                        onClick={() => setRespondTo(post)}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {tEvents("addComment")}
                      </button>
                    )}
                  </div>
                  {expanded[post.id] === "loading" && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{tCommon("loading")}</p>
                  )}
                  {Array.isArray(expanded[post.id]) && (
                    <ResponseList
                      responses={expanded[post.id] as CommunityResponse[]}
                      isAdmin={canManage}
                    />
                  )}
                </div>
              </PostCard>
            );
          })}
        </div>
      )}

      <ResponseModal
        open={respondTo !== null}
        onClose={() => setRespondTo(null)}
        onSubmit={handleRespond}
      />
    </div>
  );
}

function RsvpButton({
  active,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  tone: "green" | "yellow" | "gray";
  onClick: () => void;
}) {
  const toneMap: Record<typeof tone, { active: string; idle: string }> = {
    green: {
      active: "bg-green-600 text-white",
      idle: "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-200 dark:hover:bg-green-900/50",
    },
    yellow: {
      active: "bg-yellow-500 text-white",
      idle: "bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-200 dark:hover:bg-yellow-900/50",
    },
    gray: {
      active: "bg-gray-600 text-white",
      idle: "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
    },
  };
  const styles = toneMap[tone];
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? styles.active : styles.idle
      }`}
    >
      {label}
    </button>
  );
}
