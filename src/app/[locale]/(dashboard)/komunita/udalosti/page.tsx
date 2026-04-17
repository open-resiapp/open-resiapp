"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PostCard, {
  type CommunityPostType,
  type CommunityPostStatus,
} from "@/components/community/PostCard";
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
          <div className="text-sm text-gray-500 mb-1">
            <Link href="/komunita" className="hover:underline">
              {t("landing.title")}
            </Link>
            {" / "}
            <span>{tEvents("title")}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{tEvents("title")}</h1>
          <p className="text-base text-gray-600 mt-1">{tEvents("subtitle")}</p>
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
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {tEvents("tabs.upcoming")}
        </button>
        <button
          onClick={() => setTab("past")}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            tab === "past"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {tEvents("tabs.past")}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">{tCommon("loading")}</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <p className="text-gray-600 mb-4">{tEvents("empty")}</p>
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
                  <div className="text-sm text-gray-600">
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
                </div>
              </PostCard>
            );
          })}
        </div>
      )}
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
      idle: "bg-green-50 text-green-700 hover:bg-green-100",
    },
    yellow: {
      active: "bg-yellow-500 text-white",
      idle: "bg-yellow-50 text-yellow-700 hover:bg-yellow-100",
    },
    gray: {
      active: "bg-gray-600 text-white",
      idle: "bg-gray-100 text-gray-700 hover:bg-gray-200",
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
