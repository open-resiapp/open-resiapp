"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import PostCard from "@/components/nastenka/PostCard";
import NewPostModal from "@/components/nastenka/NewPostModal";
import EditPostModal from "@/components/nastenka/EditPostModal";
import { hasPermission } from "@/lib/permissions";
import type { UserRole, PostCategory } from "@/types";

interface PostData {
  id: string;
  title: string;
  content: string;
  category: PostCategory;
  isPinned: boolean;
  createdAt: string;
  entranceId: string | null;
  author: { id: string; name: string } | null;
}

export default function NastenkaPage() {
  const { data: session } = useSession();
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPost, setEditingPost] = useState<PostData | null>(null);

  const role = (session?.user?.role || "owner") as UserRole;
  const canCreate = hasPermission(role, "createPost");
  const isAdmin = role === "admin";

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/posts");
    if (res.ok) {
      setPosts(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  async function handleDelete(postId: string) {
    if (!confirm("Naozaj chcete zmazať tento príspevok?")) return;

    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      fetchPosts();
    }
  }

  async function handleTogglePin(post: PostData) {
    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !post.isPinned }),
    });
    if (res.ok) {
      fetchPosts();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Nástenka</h1>
        {canCreate && (
          <button
            onClick={() => setShowModal(true)}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            Nový príspevok
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse"
            >
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-full mb-1" />
              <div className="h-4 bg-gray-200 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg">
          Žiadne príspevky na nástenke.
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              title={post.title}
              content={post.content}
              category={post.category}
              authorName={post.author?.name || "Neznámy"}
              createdAt={post.createdAt}
              isPinned={post.isPinned}
              isAdmin={isAdmin}
              onEdit={() => setEditingPost(post)}
              onDelete={() => handleDelete(post.id)}
              onTogglePin={() => handleTogglePin(post)}
            />
          ))}
        </div>
      )}

      <NewPostModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onCreated={fetchPosts}
      />

      {editingPost && (
        <EditPostModal
          isOpen={true}
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={fetchPosts}
        />
      )}
    </div>
  );
}
