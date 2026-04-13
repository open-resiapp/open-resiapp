"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import type { GovernanceModel, BoardMemberRole } from "@/types";

interface BoardMemberRow {
  id: string;
  userId: string;
  role: BoardMemberRole;
  electedAt: string;
  termEndsAt: string | null;
  isActive: boolean;
  userName: string | null;
  userEmail: string | null;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

interface BoardMembersTabProps {
  canEdit: boolean;
}

const ROLE_LABELS_BY_MODEL: Record<GovernanceModel, BoardMemberRole[]> = {
  chairman_council: ["chairman", "council_member"],
  committee: ["committee_chairman", "committee_member"],
  chairman_only: ["chairman"],
};

export default function BoardMembersTab({ canEdit }: BoardMembersTabProps) {
  const t = useTranslations("BoardMembers");
  const tc = useTranslations("Common");
  const [members, setMembers] = useState<BoardMemberRow[]>([]);
  const [governanceModel, setGovernanceModel] = useState<GovernanceModel | string>("chairman_council");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<BoardMemberRole>("chairman");
  const [electedAt, setElectedAt] = useState("");
  const [termEndsAt, setTermEndsAt] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/board-members").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
    ])
      .then(([boardData, usersData]) => {
        setMembers(boardData.members || []);
        setGovernanceModel(boardData.governanceModel || "chairman_council");
        setUsers(
          (usersData || []).map((u: UserOption) => ({
            id: u.id,
            name: u.name,
            email: u.email,
          }))
        );
        // Set default role based on governance model
        const gm = (boardData.governanceModel || "chairman_council") as GovernanceModel;
        const roles = ROLE_LABELS_BY_MODEL[gm];
        setRole(roles[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const availableRoles = ROLE_LABELS_BY_MODEL[governanceModel as GovernanceModel] || [];

  const handleAdd = async () => {
    if (!userId || !role || !electedAt) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/board-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          role,
          electedAt,
          termEndsAt: termEndsAt || null,
        }),
      });

      if (!res.ok) throw new Error();

      // Refresh
      const boardData = await fetch("/api/board-members").then((r) => r.json());
      setMembers(boardData.members || []);
      setAdding(false);
      setUserId("");
      setElectedAt("");
      setTermEndsAt("");
      setMessage({ type: "success", text: t("memberAdded") });
    } catch {
      setMessage({ type: "error", text: t("memberAddFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    setMessage(null);
    try {
      const res = await fetch(`/api/board-members?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMembers((prev) => prev.filter((m) => m.id !== id));
      setMessage({ type: "success", text: t("memberRemoved") });
    } catch {
      setMessage({ type: "error", text: t("memberRemoveFailed") });
    }
  };

  const isTermExpiring = (termEndsAt: string | null) => {
    if (!termEndsAt) return false;
    const end = new Date(termEndsAt);
    const now = new Date();
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    return end.getTime() - now.getTime() < sixtyDays && end > now;
  };

  const isTermExpired = (termEndsAt: string | null) => {
    if (!termEndsAt) return false;
    return new Date(termEndsAt) < new Date();
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    );
  }

  const activeMembers = members.filter((m) => m.isActive);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t("title")}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {t(`model_${governanceModel}`)}
            </p>
          </div>
          {canEdit && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="px-4 py-2 text-base text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg transition-colors"
            >
              {t("addMember")}
            </button>
          )}
        </div>

        {message && (
          <div
            className={`mb-4 p-3 rounded-lg text-base ${
              message.type === "success"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Add form */}
        {adding && (
          <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 mb-1">{t("userLabel")}</label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="">{t("selectUser")}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">{t("roleLabel")}</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as BoardMemberRole)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>
                      {t(`role_${r}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 mb-1">{t("electedAtLabel")}</label>
                <input
                  type="date"
                  value={electedAt}
                  onChange={(e) => setElectedAt(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">{t("termEndsAtLabel")}</label>
                <input
                  type="date"
                  value={termEndsAt}
                  onChange={(e) => setTermEndsAt(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleAdd}
                disabled={saving || !userId || !electedAt}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? tc("saving") : tc("save")}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="px-5 py-3 text-gray-700 hover:text-gray-900 text-base font-medium transition-colors"
              >
                {tc("cancel")}
              </button>
            </div>
          </div>
        )}

        {/* Members list */}
        {activeMembers.length === 0 ? (
          <p className="text-base text-gray-500">{t("noMembers")}</p>
        ) : (
          <div className="space-y-3">
            {activeMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-medium text-gray-900">
                      {member.userName || member.userEmail}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                      {t(`role_${member.role}`)}
                    </span>
                    {isTermExpired(member.termEndsAt) && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                        {t("termExpired")}
                      </span>
                    )}
                    {isTermExpiring(member.termEndsAt) && !isTermExpired(member.termEndsAt) && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                        {t("termExpiring")}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {t("electedOn", {
                      date: new Date(member.electedAt).toLocaleDateString(),
                    })}
                    {member.termEndsAt && (
                      <>
                        {" "}
                        &middot;{" "}
                        {t("termUntil", {
                          date: new Date(member.termEndsAt).toLocaleDateString(),
                        })}
                      </>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <button
                    onClick={() => handleRemove(member.id)}
                    className="text-sm text-red-600 hover:text-red-700 font-medium"
                  >
                    {t("remove")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
