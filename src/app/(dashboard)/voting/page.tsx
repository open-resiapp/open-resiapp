"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import VotingCard from "@/components/voting/VotingCard";
import { hasPermission } from "@/lib/permissions";
import type { UserRole, VotingStatus } from "@/types";

interface VotingData {
  id: string;
  title: string;
  status: VotingStatus;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export default function HlasovaniePage() {
  const { data: session } = useSession();
  const [votings, setVotings] = useState<VotingData[]>([]);
  const [loading, setLoading] = useState(true);

  const role = (session?.user?.role || "owner") as UserRole;
  const canCreate = hasPermission(role, "createVoting");

  useEffect(() => {
    fetch("/api/votings")
      .then((r) => r.json())
      .then((data) => {
        setVotings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Hlasovanie</h1>
        {canCreate && (
          <Link
            href="/voting/new"
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
          >
            Nové hlasovanie
          </Link>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse"
            >
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-3" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : votings.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-lg">
          Zatiaľ neboli vytvorené žiadne hlasovania.
        </div>
      ) : (
        <div className="space-y-4">
          {votings.map((v) => (
            <VotingCard
              key={v.id}
              id={v.id}
              title={v.title}
              status={v.status}
              startsAt={v.startsAt}
              endsAt={v.endsAt}
              createdByName={v.createdBy?.name || "Neznámy"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
