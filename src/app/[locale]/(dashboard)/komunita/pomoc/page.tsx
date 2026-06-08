"use client";

import { useEffect, useState, useCallback } from "react";
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
  responsesAllowed: boolean;
  responseCount?: number;
}

type TabValue = "all" | "help_request" | "help_offer";

const HELP_TYPES: CommunityPostType[] = ["help_request", "help_offer"];

const TABS: { value: TabValue; labelKey: string }[] = [
  { value: "all", labelKey: "tabs.all" },
  { value: "help_request", labelKey: "tabs.request" },
  { value: "help_offer", labelKey: "tabs.offer" },
];

export default function HelpPage() {
  const { data: session } = useSession();
  const t = useTranslations("Community");
  const tHelp = useTranslations("Community.help");
  const tCommon = useTranslations("Common");
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabValue>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [respondTo, setRespondTo] = useState<PostData | null>(null);
  // Per-post: cached response list once expanded.
  const [expanded, setExpanded] = useState<Record<string, CommunityResponse[] | "loading" | undefined>>({});

  async function toggleResponses(postId: string) {
    const current = expanded[postId];
    if (current && current !== "loading") {
      // Collapse — drop cached responses.
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

  const role = (session?.user?.role || "owner") as UserRole;
  const userId = session?.user?.id;
  const isAdmin = role === "admin";

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    const typesForRequest = tab === "all" ? HELP_TYPES : [tab];
    params.set("type", typesForRequest.join(","));
    if (showArchived) {
      params.set("includeResolved", "true");
      params.set("includeExpired", "true");
    }
    try {
      const res = await fetch(`/api/community/posts?${params.toString()}`);
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, [tab, showArchived]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  async function handleRespond(content: string) {
    if (!respondTo) return;
    await fetch(`/api/community/posts/${respondTo.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async function handleResolve(post: PostData) {
    if (!confirm(tHelp("confirmResolve"))) return;
    const res = await fetch(`/api/community/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    if (res.ok) fetchPosts();
  }

  async function handleDelete(post: PostData) {
    if (!confirm(tHelp("confirmDelete"))) return;
    const res = await fetch(`/api/community/posts/${post.id}`, {
      method: "DELETE",
    });
    if (res.ok) fetchPosts();
  }

  async function handleToggleResponses(post: PostData) {
    const res = await fetch(`/api/community/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responsesAllowed: !post.responsesAllowed }),
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
            <span>{tHelp("title")}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{tHelp("title")}</h1>
          <p className="text-base text-gray-600 mt-1 dark:text-gray-300">{tHelp("subtitle")}</p>
        </div>
        <Link
          href="/komunita/pomoc/novy"
          className="px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          {t("addPost")}
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-2 overflow-x-auto">
        {TABS.map((item) => (
          <button
            key={item.value}
            onClick={() => setTab(item.value)}
            className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap ${
              tab === item.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {tHelp(item.labelKey)}
          </button>
        ))}
      </div>

      <label className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
        />
        {tHelp("showArchived")}
      </label>

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">{tCommon("loading")}</p>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center dark:bg-gray-800 dark:shadow-black/40">
          <p className="text-gray-600 mb-4 dark:text-gray-300">{tHelp("empty")}</p>
          <Link
            href="/komunita/pomoc/novy"
            className="inline-block px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            {t("addPost")}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map((post) => {
            const isAuthor = post.author?.id === userId;
            const canManage = isAuthor || isAdmin;
            const ctaKey =
              post.type === "help_request" ? "willHelp" : "imInterested";
            return (
              <PostCard
                key={post.id}
                id={post.id}
                type={post.type}
                status={post.status}
                title={post.title}
                content={post.content}
                photoUrl={post.photoUrl}
                authorName={post.author?.name || "—"}
                createdAt={post.createdAt}
                entranceName={post.entranceName}
                canManage={canManage}
                responsesAllowed={post.responsesAllowed}
                onResolve={canManage ? () => handleResolve(post) : undefined}
                onDelete={canManage ? () => handleDelete(post) : undefined}
                onToggleResponses={
                  canManage ? () => handleToggleResponses(post) : undefined
                }
              >
                {post.status === "active" &&
                  (post.responsesAllowed === false ? (
                    <p className="w-full text-center text-sm text-gray-500 dark:text-gray-400">
                      {t("responsesDisabled")}
                    </p>
                  ) : (
                    !isAuthor && (
                      <button
                        onClick={() => setRespondTo(post)}
                        className="w-full px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                      >
                        {tHelp(ctaKey)}
                      </button>
                    )
                  ))}
                {(post.responseCount ?? 0) > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                    <button
                      onClick={() => toggleResponses(post.id)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {expanded[post.id]
                        ? t("hideResponses")
                        : t("showResponses", { count: post.responseCount ?? 0 })}
                    </button>
                    {expanded[post.id] === "loading" && (
                      <p className="text-sm text-gray-500 mt-2 dark:text-gray-400">{tCommon("loading")}</p>
                    )}
                    {Array.isArray(expanded[post.id]) && (
                      <div className="mt-3">
                        <ResponseList
                          responses={expanded[post.id] as CommunityResponse[]}
                          isAdmin={canManage}
                        />
                      </div>
                    )}
                  </div>
                )}
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
