"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export default function NovaHlasovaniePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const t = useTranslations("VotingNew");
  const tCommon = useTranslations("Common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [votingType, setVotingType] = useState("written");
  const [initiatedBy, setInitiatedBy] = useState("board");

  const role = (session?.user?.role || "owner") as UserRole;

  if (!hasPermission(role, "createVoting")) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg">
        {t("noPermission")}
      </div>
    );
  }

  const showRestrictionNote =
    votingType === "meeting" || initiatedBy === "owners_quarter";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/votings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        description: formData.get("description"),
        startsAt: formData.get("startsAt"),
        endsAt: formData.get("endsAt"),
        status: formData.get("status"),
        votingType: formData.get("votingType"),
        initiatedBy: formData.get("initiatedBy"),
        quorumType: formData.get("quorumType"),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("createFailed"));
      setLoading(false);
      return;
    }

    const voting = await res.json();
    router.push(`/voting/${voting.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/voting")}
        className="text-blue-600 hover:underline text-base mb-4 inline-block"
      >
        &larr; {tCommon("backToList")}
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {t("title")}
        </h1>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("titleLabel")}
            </label>
            <input
              name="title"
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder={t("titlePlaceholder")}
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("descriptionLabel")}
            </label>
            <textarea
              name="description"
              rows={4}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical"
              placeholder={t("descriptionPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                {t("startsAtLabel")}
              </label>
              <input
                name="startsAt"
                type="datetime-local"
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                {t("endsAtLabel")}
              </label>
              <input
                name="endsAt"
                type="datetime-local"
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Voting Type */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("votingTypeLabel")}
            </label>
            <select
              name="votingType"
              value={votingType}
              onChange={(e) => setVotingType(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="written">{t("votingTypeWritten")}</option>
              <option value="meeting">{t("votingTypeMeeting")}</option>
            </select>
          </div>

          {/* Initiated By */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("initiatedByLabel")}
            </label>
            <select
              name="initiatedBy"
              value={initiatedBy}
              onChange={(e) => setInitiatedBy(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="board">{t("initiatedByBoard")}</option>
              <option value="owners_quarter">{t("initiatedByOwnersQuarter")}</option>
            </select>
          </div>

          {/* Restriction note */}
          {showRestrictionNote && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-base text-amber-800">
              {votingType === "meeting"
                ? t("meetingNote")
                : t("ownersQuarterNote")}
            </div>
          )}

          {/* Quorum Type */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("quorumTypeLabel")}
            </label>
            <select
              name="quorumType"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="simple_all">{t("quorumSimpleAll")}</option>
              <option value="simple_present">{t("quorumSimplePresent")}</option>
              <option value="two_thirds_all">{t("quorumTwoThirdsAll")}</option>
              <option value="all_unanimous">{t("quorumAllUnanimous")}</option>
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("statusLabel")}
            </label>
            <select
              name="status"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="draft">{t("statusDraft")}</option>
              <option value="active">{t("statusActive")}</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => router.push("/voting")}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? t("submitting") : t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
