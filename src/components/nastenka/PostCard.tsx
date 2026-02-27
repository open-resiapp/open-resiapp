import type { PostCategory } from "@/types";

const categoryConfig: Record<
  PostCategory,
  { label: string; bg: string; text: string }
> = {
  info: { label: "Informácia", bg: "bg-blue-100", text: "text-blue-700" },
  urgent: { label: "Dôležité", bg: "bg-red-100", text: "text-red-700" },
  event: { label: "Udalosť", bg: "bg-green-100", text: "text-green-700" },
  maintenance: {
    label: "Údržba",
    bg: "bg-yellow-100",
    text: "text-yellow-700",
  },
};

interface PostCardProps {
  title: string;
  content: string;
  category: PostCategory;
  authorName: string;
  createdAt: string;
  isPinned: boolean;
  isAdmin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
}

export default function PostCard({
  title,
  content,
  category,
  authorName,
  createdAt,
  isPinned,
  isAdmin,
  onEdit,
  onDelete,
  onTogglePin,
}: PostCardProps) {
  const cat = categoryConfig[category] || categoryConfig.info;

  return (
    <div
      className={`bg-white rounded-xl border p-6 ${
        isPinned ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isPinned && (
            <span className="text-sm font-medium text-blue-600">
              Pripnuté
            </span>
          )}
          <span
            className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${cat.bg} ${cat.text}`}
          >
            {cat.label}
          </span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onTogglePin}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {isPinned ? "Odopnúť" : "Pripnúť"}
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Upraviť
            </button>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              Zmazať
            </button>
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-base text-gray-700 whitespace-pre-wrap mb-4">
        {content}
      </p>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{authorName}</span>
        <time>
          {new Date(createdAt).toLocaleDateString("sk-SK", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </time>
      </div>
    </div>
  );
}
