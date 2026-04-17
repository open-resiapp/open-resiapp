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
}

type TabValue = "all" | "sale" | "free" | "borrow";

const MARKETPLACE_TYPES: CommunityPostType[] = ["sale", "free", "borrow"];

const TABS: { value: TabValue; labelKey: string }[] = [
  { value: "all", labelKey: "tabs.all" },
  { value: "sale", labelKey: "tabs.sale" },
  { value: "free", labelKey: "tabs.free" },
  { value: "borrow", labelKey: "tabs.borrow" },
];

export default function MarketplacePage() {
  const { data: session } = useSession();
  const t = useTranslations("Community");
  const tMarket = useTranslations("Community.marketplace");
  const tCommon = useTranslations("Common");
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabValue>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [respondTo, setRespondTo] = useState<PostData | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const userId = session?.user?.id;
  const isAdmin = role === "admin";

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    const typesForRequest = tab === "all" ? MARKETPLACE_TYPES : [tab];
    params.set("type", typesForRequest.join(","));
    if (showArchived) {
      params.set("includeResolved", "true");
      params.set("includeExpired", "true");
    }
    try {
      const res = await fetch(`/api/community/posts?${params.toString()}`);
      if (res.ok) {
        setPosts(await res.json());
      }
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
    if (!confirm(tMarket("confirmResolve"))) return;
    const res = await fetch(`/api/community/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    if (res.ok) fetchPosts();
  }

  async function handleDelete(post: PostData) {
    if (!confirm(tMarket("confirmDelete"))) return;
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
            <span>{tMarket("title")}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{tMarket("title")}</h1>
          <p className="text-base text-gray-600 mt-1">{tMarket("subtitle")}</p>
        </div>
        <Link
          href="/komunita/burza/novy"
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
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {tMarket(item.labelKey)}
          </button>
        ))}
      </div>

      <label className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          className="rounded border-gray-300"
        />
        {tMarket("showArchived")}
      </label>

      {loading ? (
        <p className="text-gray-500">{tCommon("loading")}</p>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <p className="text-gray-600 mb-4">{t("empty")}</p>
          <Link
            href="/komunita/burza/novy"
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
                onResolve={canManage ? () => handleResolve(post) : undefined}
                onDelete={canManage ? () => handleDelete(post) : undefined}
              >
                {post.status === "active" && (
                  <button
                    onClick={() => setRespondTo(post)}
                    className="w-full px-4 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    {tMarket("imInterested")}
                  </button>
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
