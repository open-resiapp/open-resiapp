"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { UserRole } from "@/types";

interface PendingUser {
  id: string;
  name: string;
  email: string;
}

interface FlatOption {
  id: string;
  flatNumber: string;
  entranceName: string | null;
}

const ROLE_OPTIONS: UserRole[] = [
  "owner",
  "tenant",
  "admin",
  "vote_counter",
  "caretaker",
];

export default function PendingApprovalModal({
  user,
  onClose,
  onApproved,
}: {
  user: PendingUser;
  onClose: () => void;
  onApproved: () => void;
}) {
  const t = useTranslations("PendingRegistrations");
  const tOwners = useTranslations("Owners");
  const tCommon = useTranslations("Common");

  const [flats, setFlats] = useState<FlatOption[]>([]);
  const [flatId, setFlatId] = useState("");
  const [role, setRole] = useState<UserRole>("owner");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/flats")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: FlatOption[]) => setFlats(rows))
      .catch(() => setFlats([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!flatId) {
      setError(t("flatRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/registrations/${user.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flatId, role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || tCommon("saveFailed"));
      setSubmitting(false);
      return;
    }
    onApproved();
  }

  const roleLabels: Record<UserRole, string> = {
    admin: tOwners("roleAdmin"),
    owner: tOwners("roleOwner"),
    tenant: tOwners("roleTenant"),
    vote_counter: tOwners("roleVoteCounter"),
    caretaker: tOwners("roleCaretaker"),
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-gray-800 dark:shadow-black/40">
        <h2 className="text-xl font-semibold text-gray-900 mb-1 dark:text-gray-100">
          {t("approveTitle")}
        </h2>
        <p className="text-base text-gray-600 mb-4 dark:text-gray-300">
          {user.name} · {user.email}
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("flatLabel")}
            </label>
            <select
              value={flatId}
              onChange={(e) => setFlatId(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="">{t("flatPlaceholder")}</option>
              {flats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.entranceName ? `${f.entranceName} — ` : ""}
                  {f.flatNumber}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("roleLabel")}
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {roleLabels[r]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 text-base text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || !flatId}
              className="px-5 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-base font-medium rounded-lg transition-colors"
            >
              {submitting ? tCommon("saving") : t("approve")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
