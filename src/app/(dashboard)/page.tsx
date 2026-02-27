"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

function StatCard({
  title,
  value,
  href,
  color,
}: {
  title: string;
  value: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className={`text-sm font-medium ${color} mb-1`}>{title}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const role = (session?.user?.role || "owner") as UserRole;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        Vitajte, {session?.user?.name}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Nástenka"
          value="Zobraziť príspevky"
          href="/board"
          color="text-blue-600"
        />

        <StatCard
          title="Hlasovanie"
          value="Aktívne hlasovania"
          href="/voting"
          color="text-green-600"
        />

        {hasPermission(role, "manageUsers") && (
          <StatCard
            title="Vlastníci"
            value="Správa vlastníkov"
            href="/owners"
            color="text-purple-600"
          />
        )}
      </div>
    </div>
  );
}
