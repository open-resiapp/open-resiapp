import Link from "next/link";
import type { VotingStatus } from "@/types";

const statusConfig: Record<
  VotingStatus,
  { label: string; bg: string; text: string }
> = {
  draft: { label: "Návrh", bg: "bg-gray-100", text: "text-gray-700" },
  active: { label: "Aktívne", bg: "bg-green-100", text: "text-green-700" },
  closed: { label: "Ukončené", bg: "bg-red-100", text: "text-red-700" },
};

interface VotingCardProps {
  id: string;
  title: string;
  status: VotingStatus;
  startsAt: string;
  endsAt: string;
  createdByName: string;
}

export default function VotingCard({
  id,
  title,
  status,
  startsAt,
  endsAt,
  createdByName,
}: VotingCardProps) {
  const s = statusConfig[status] || statusConfig.draft;

  return (
    <Link
      href={`/voting/${id}`}
      className="block bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${s.bg} ${s.text}`}
        >
          {s.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
        <span>
          Od:{" "}
          {new Date(startsAt).toLocaleDateString("sk-SK", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span>
          Do:{" "}
          {new Date(endsAt).toLocaleDateString("sk-SK", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span>Vytvoril: {createdByName}</span>
      </div>
    </Link>
  );
}
