"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

interface BuildingInfo {
  id: string;
  name: string;
  address: string;
  ico: string | null;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const role = (session?.user?.role || "owner") as UserRole;

  if (!hasPermission(role, "viewSettings")) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        Nemáte oprávnenie na zobrazenie nastavení.
      </div>
    );
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    fetch("/api/building")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setBuildingInfo(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nastavenia</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          Informácie o bytovom dome
        </h2>

        {buildingInfo ? (
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-gray-500">Názov</dt>
              <dd className="text-base text-gray-900">{buildingInfo.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Adresa</dt>
              <dd className="text-base text-gray-900">
                {buildingInfo.address}
              </dd>
            </div>
            {buildingInfo.ico && (
              <div>
                <dt className="text-sm text-gray-500">IČO</dt>
                <dd className="text-base text-gray-900">{buildingInfo.ico}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-base text-gray-500">
            Informácie o bytovom dome nie sú k dispozícii.
          </p>
        )}
      </div>
    </div>
  );
}
